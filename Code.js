// To learn how to use this script, refer to the documentation:
// https://developers.google.com/apps-script/samples/automations/vacation-calendar

/*
Copyright 2022 Google LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

// Set the ID of the team calendar to add events to. You can find the calendar's
// ID on the settings page.
const TEAM_CALENDAR_ID = 'c_hhgpsc5176s57777vtulrpgorc@group.calendar.google.com';
// Set the email address of the Google Group that contains everyone in the team.
// Ensure the group has less than 500 members to avoid timeouts.
// Change to an array in order to add indirect members from multiple groups, for example:
// const GROUP_EMAIL = ['ENTER_GOOGLE_GROUP_EMAIL_HERE', 'ENTER_ANOTHER_GOOGLE_GROUP_EMAIL_HERE'];
const GROUP_EMAIL = ['pde@vida.com', 'dev-offshore@vida.com'];

const KEYWORDS = ['pto', 'ooo', 'out of office'];

const SYNC_TOKEN_PREFIX = 'syncToken_'
const FULL_SYNC_INTERVAL_KEY = 'lastFullSync'
const FULL_SYNC_INTERVAL_DAYS = 7

/**
 * Sets up the script to run automatically every hour.
 */
function setup() {
  let triggers = ScriptApp.getProjectTriggers();
  if (triggers.length > 0) {
    throw new Error('Triggers are already set up.');
  }
  ScriptApp.newTrigger('sync').timeBased().everyHours(1).create();
  // Runs the first sync immediately.
  sync();
}

/**
 * Looks through the group members' public calendars and adds any
 * 'vacation' or 'out of office' events to the team calendar.
 */
function sync() {
  let today = new Date();

  let users;
  if (Array.isArray(GROUP_EMAIL)) {
    users = getUsersFromGroups(GROUP_EMAIL);
  } else {
    users = getAllMembers(GROUP_EMAIL);
  }

  let props = PropertiesService.getScriptProperties();

  let lastFullSync = props.getProperty(FULL_SYNC_INTERVAL_KEY);
  let forceFullSync = false;
  if (!lastFullSync || daysSince(new Date(lastFullSync)) >= FULL_SYNC_INTERVAL_DAYS) {
    console.log('Forcing full sync (last was %s)', lastFullSync || 'never');
    forceFullSync = true;
  }

  let count = 0;
  users.forEach(function(user) {
    let email = user.getEmail();
    let username = email.split('@')[0];
    let tokenKey = SYNC_TOKEN_PREFIX + email;
    let syncToken = forceFullSync ? null : props.getProperty(tokenKey);

    console.log('Checking events for %s (%s)', username, syncToken ? 'incremental' : 'full sync');
    try {
      let result = syncToken
          ? incrementalSync(user, syncToken)
          : fullSync(user, today);
      result.events.forEach(function(event) {
        importEvent(username, event);
        count++;
      });

      if (result.nextSyncToken) {
        props.setProperty(tokenKey, result.nextSyncToken);
      }
    } catch (e) {
      console.error('Failed to sync events for %s: %s; skipping', username, e.toString());
    }
  });

  if (forceFullSync) {
    props.setProperty(FULL_SYNC_INTERVAL_KEY, today.toISOString());
  }
  console.log('Imported ' + count + ' events');
}

/**
 * Imports the given event from the user's calendar into the shared team
 * calendar.
 * @param {string} username The team member that is attending the event.
 * @param {Calendar.Event} event The event to import.
 */
function importEvent(username, event) {
  event.summary = '[' + username + '] ' + event.summary;
  event.organizer = {
    id: TEAM_CALENDAR_ID,
  };
  event.attendees = [];
  delete event.sequence;

  // If the event is not of type 'default', it can't be imported, so it needs
  // to be changed.
  if (event.eventType != 'default') {
    event.eventType = 'default';
    delete event.outOfOfficeProperties;
    delete event.focusTimeProperties;
  }

  console.log('Importing: %s', event.summary);
  try {
    Calendar.Events.import(event, TEAM_CALENDAR_ID);
  } catch (e) {
    console.error('Error attempting to import event: %s. Skipping %s.',
        e.toString(), event);
  }
}

/**
 * Full sync: fetches all future OOO events for a user from today onward.
 * No timeMax — captures everything so the sync token won't have blind spots.
 * @param {Session.User} user The user to retrieve events for.
 * @param {Date} start The starting date (typically today).
 * @return {{events: Calendar.Event[], nextSyncToken: string}}
 */
function fullSync(user, start) {
  let params = {
    timeMin: formatDateAsRFC3339(start),
    showDeleted: true,
    eventTypes: ["outOfOffice"],
  };
  return fetchEvents(user, params);
}

/**
 * Incremental sync: fetches only events that changed since the last sync.
 * Falls back to a full sync if the token has expired (410 Gone).
 * @param {Session.User} user The user to retrieve events for.
 * @param {string} syncToken Token from a previous sync response.
 * @return {{events: Calendar.Event[], nextSyncToken: string}}
 */
function incrementalSync(user, syncToken) {
  let params = {
    syncToken: syncToken,
    showDeleted: true,
  };
  try {
    return fetchEvents(user, params);
  } catch (e) {
    if (e.toString().indexOf('410') !== -1) {
      console.log('Sync token expired for %s, falling back to full sync', user.getEmail());
      return fullSync(user, new Date());
    }
    throw e;
  }
}

/**
 * Paginates through Calendar.Events.list and returns matching events
 * along with the sync token for next time.
 * @param {Session.User} user The user to retrieve events for.
 * @param {object} params Parameters for Calendar.Events.list.
 * @return {{events: Calendar.Event[], nextSyncToken: string}}
 */
function fetchEvents(user, params) {
  let events = [];
  let nextSyncToken = null;
  let pageToken = null;
  do {
    params.pageToken = pageToken;
    let response;
    try {
      response = Calendar.Events.list(user.getEmail(), params);
    } catch (e) {
      console.error('Error retrieving events for %s: %s',
          user, e.toString());
      throw e;
    }
    events = events.concat(response.items.filter(function(item) {
      return shouldImportEvent(user, item);
    }));
    pageToken = response.nextPageToken;
    if (response.nextSyncToken) {
      nextSyncToken = response.nextSyncToken;
    }
  } while (pageToken);
  return { events: events, nextSyncToken: nextSyncToken };
}

/**
 * Determines if the given event should be imported into the shared team
 * calendar.
 * @param {Session.User} user The user that is attending the event.
 * @param {Calendar.Event} event The event being considered.
 * @return {boolean} True if the event should be imported.
 */
function shouldImportEvent(user, event) {

  // OOO events must be at least 6 hours to sync
  const start = new Date(event.start.dateTime || event.start.date);
  const end = new Date(event.end.dateTime || event.end.date);
  const durationMs = end - start;
  const durationHrs = durationMs/1000/60/60
  if (durationHrs < 6) {
    console.log('%d hour event filtered out of syncing', durationHrs)
    return false
  };

  // Filters out events where the keyword did not appear in the summary
  // (that is, the keyword appeared in a different field, and are thus
  // is not likely to be relevant).
  const summary = event.summary || '';
  if (!KEYWORDS.some(keyword => summary.toLowerCase().includes(keyword.toLowerCase()))) {
    console.log('No keywords found in event %s', event.summary);
    return false;
  }
  if (!event.organizer || event.organizer.email == user.getEmail()) {
    // If the user is the creator of the event, always imports it.
    return true;
  }
  // Only imports events the user has accepted.
  console.log('Advanced member check for event %s', event.summary);
  if (!event.attendees) return false;
  let matching = event.attendees.filter(function(attendee) {
    return attendee.self;
  });
  return matching.length > 0 && matching[0].responseStatus == 'accepted';
}

/**
 * Returns an RFC3339 formatted date String corresponding to the given
 * Date object.
 * @param {Date} date a Date.
 * @return {string} a formatted date string.
 */
function formatDateAsRFC3339(date) {
  return Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd\'T\'HH:mm:ssZ');
}

function daysSince(date) {
  return Math.floor((new Date() - date) / (1000 * 60 * 60 * 24));
}

/**
* Get both direct and indirect members (and delete duplicates).
* @param {string} the e-mail address of the group.
* @return {object} direct and indirect members.
*/
function getAllMembers(groupEmail) {
  var group = GroupsApp.getGroupByEmail(groupEmail);
  var users = group.getUsers();
  var childGroups = group.getGroups();
  for (var i = 0; i < childGroups.length; i++) {
    var childGroup = childGroups[i];
    users = users.concat(getAllMembers(childGroup.getEmail()));
  }
  // Remove duplicate members
  var uniqueUsers = [];
  var userEmails = {};
  for (var i = 0; i < users.length; i++) {
    var user = users[i];
    if (!userEmails[user.getEmail()]) {
      uniqueUsers.push(user);
      userEmails[user.getEmail()] = true;
    }
  }
  return uniqueUsers;
}

/**
* Get indirect members from multiple groups (and delete duplicates).
* @param {array} the e-mail addresses of multiple groups.
* @return {object} indirect members of multiple groups.
*/
function getUsersFromGroups(groupEmails) {
  let users = [];
  for (let groupEmail of groupEmails) {
    try {
      let groupUsers = GroupsApp.getGroupByEmail(groupEmail).getUsers();
      for (let user of groupUsers) {
        if (!users.some(u => u.getEmail() === user.getEmail())) {
          users.push(user);
        }
      }
    } catch (e) {
      console.error('Could not retrieve members for group %s: %s; skipping',
          groupEmail, e.toString());
    }
  }
  return users;
}
