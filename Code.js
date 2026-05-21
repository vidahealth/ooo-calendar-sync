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
const MONTHS_IN_ADVANCE = 3;

// Define a safe threshold (e.g., 20 days) to avoid the API error "API call to calendar.events.list failed with error: The requested minimum modification time lies too far in the past"
const MAX_INCREMENTAL_DAYS = 7;

const LAST_RUN_KEY = 'lastRun'
const EXISTING_USERS_KEY = 'existing_users'

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
  // Defines the calendar event date range to search.
  let today = new Date();
  let maxDate = new Date();
  maxDate.setMonth(maxDate.getMonth() + MONTHS_IN_ADVANCE);

  // Determines the time the the script was last run.
  let lastRun = PropertiesService.getScriptProperties().getProperty(LAST_RUN_KEY);
  lastRun = lastRun ? new Date(lastRun) : null;
  // lastRun = null; // for testing

  // Calculate difference in days
  const diffTime = Math.abs(today - lastRun);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays > MAX_INCREMENTAL_DAYS) {
    console.log("lastRun was too old (%s days ago, %s)", diffDays, lastRun)
    lastRun = null;
  }
  console.log("only searching events modified since %s", lastRun)

  let existing_users = PropertiesService.getScriptProperties().getProperty(EXISTING_USERS_KEY);
  existing_users = existing_users ? existing_users.split(",") : [];

  // Gets the list of users in the Google Group.
  let users;
  if (Array.isArray(GROUP_EMAIL)) {
    users = getUsersFromGroups(GROUP_EMAIL);
  } else {
    users = getAllMembers(GROUP_EMAIL);
  }

  // For each user, finds events having one or more of the keywords in the event
  // summary in the specified date range. Imports each of those to the team
  // calendar.
  let count = 0;
  users.forEach(function(user) {
    let username = user.getEmail().split('@')[0];
    let lastRunForUser = lastRun;
    if (!existing_users.includes(username)) {
      console.log("new user %s detected", username);
      lastRunForUser = null;
      existing_users.push(username);
      // makeTriggerForCalendarId(user.getEmail()); // we were failing for having too many triggers :(
    }
    console.log('Checking events for %s', username);
    let events = findEvents(user, today, maxDate, lastRunForUser);
    events.forEach(function(event) {
      importEvent(username, event);
      count++;
    }); // End foreach event.
  }); // End foreach user.

  PropertiesService.getScriptProperties().setProperty(LAST_RUN_KEY, today);
  PropertiesService.getScriptProperties().setProperty(EXISTING_USERS_KEY, existing_users.join(","));
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
 * In a given user's calendar, looks for occurrences of the given keyword
 * in events within the specified date range and returns any such events
 * found.
 * @param {Session.User} user The user to retrieve events for.
 * @param {Date} start The starting date of the range to examine.
 * @param {Date} end The ending date of the range to examine.
 * @param {Date} optSince A date indicating the last time this script was run.
 * @return {Calendar.Event[]} An array of calendar events.
 */
function findEvents(user, start, end, optSince) {
  let params = {
    timeMin: formatDateAsRFC3339(start),
    timeMax: formatDateAsRFC3339(end),
    showDeleted: true,
    eventTypes: ["outOfOffice"],
  };
  if (optSince) {
    // This prevents the script from examining events that have not been
    // modified since the specified date (that is, the last time the
    // script was run).
    params.updatedMin = formatDateAsRFC3339(optSince);
  }
  let pageToken = null;
  let events = [];
  do {
    params.pageToken = pageToken;
    let response;
    try {
      response = Calendar.Events.list(user.getEmail(), params);
    } catch (e) {
      console.error('Error retrieving events for %s: %s; skipping',
          user, e.toString());
      break;
    }
    events = events.concat(response.items.filter(function(item) {
      return shouldImportEvent(user, item);
    }));
    pageToken = response.nextPageToken;
  } while (pageToken);
  return events;
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
