// loosely based on https://stackoverflow.com/a/52636030/26561737

function test() {
  const id = 'elisa.orellana@vida.com'
  makeTriggerForCalendarId(id)
  return
  subscribeToCalendarChangesFor(id)
}

function makeTriggerForCalendarId(id) {
  const triggers = ScriptApp.getProjectTriggers();
  const calendarTrigger = triggers.find(trigger => trigger.getTriggerSourceId() === id);
  
  if (calendarTrigger) {
    console.log("calendar trigger already exists with id " + id)
    return
  }
  var t = ScriptApp.newTrigger("sync")
        .forUserCalendar(id)
        .onEventUpdated()
        .create();
  console.log({ message: "Created event trigger for calendar id " + id,
                triggerId: t.getUniqueId() });
}

///// Stuff below here isn't really working /////
function subscribeToCalendarChangesFor(user) {
  cal = getCalendarFor(user);
  if (cal) {
    makeTrigger(cal)
  } else {
    console.log("calendar not found for " + user)
  }
}

function makeTrigger(cal) {
  console.log(cal)
  const id = cal.getId()
  const triggers = ScriptApp.getProjectTriggers();
  const calendarTrigger = triggers.find(trigger => trigger.getTriggerSourceId() === id);
  
  if (calendarTrigger) {
    console.log("calendar trigger already exists with id " + id)
    return
  }
  var t = ScriptApp.newTrigger("sync")
        .forUserCalendar(cal.getId())
        .onEventUpdated()
        .create();
  console.log({ message: "Created event trigger for calendar " + cal.getName(),
                desc: cal.getDescription(), id: id, triggerId: t.getUniqueId() });
}

function getCalendarFor(user) {

  let calendars = CalendarApp.getAllCalendars()
  console.log(calendars.map(calendar => calendar.getId()))
  return CalendarApp.getCalendarById(user)

  const options = {
    id: user,
    fields: "nextPageToken, items(id,summary,description)"
  };

  do {
    var search = Calendar.CalendarList.list(options);
    options.pageToken = search.nextPageToken;
    console.log(search.items)
    let item = search.items.find(item => item.id === user);
    if (item) {
      return item;
    }
  } while (options.pageToken);
  return null;
}