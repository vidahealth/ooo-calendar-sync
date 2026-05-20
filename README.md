# OOO Calendar Sync

Google Apps Script that syncs out-of-office events from team members' individual calendars into a shared team calendar. Based on Google's [vacation calendar sample](https://developers.google.com/apps-script/samples/automations/vacation-calendar).

## How it works

1. Pulls the member list from configured Google Groups (`pde@vida.com`, `dev-offshore@vida.com`)
2. Scans each member's calendar for OOO events (looking for `outOfOffice` event types with keywords like "pto", "ooo", "out of office")
3. Imports matching events into the shared team calendar, prefixed with the username (e.g. `[jane.doe] OOO - Vacation`)
4. Only syncs events that are at least 6 hours long and up to 3 months in the future
5. Uses incremental sync — on subsequent runs, only checks events modified since the last run (within a 7-day window)

Runs on a time-based trigger every 5 minutes.

## Files

| File | Description |
|---|---|
| `Code.js` | Main sync logic — group member lookup, event filtering, and calendar import |
| `CalendarTrigger.js` | Experimental calendar-change triggers (not actively used) |
| `appsscript.json` | Apps Script project manifest (runtime config, scopes, advanced services) |

## Setup

### Prerequisites

- A Google Workspace account with access to the target Google Groups
- A shared Google Calendar to import events into
- The [Calendar Advanced Service](https://developers.google.com/apps-script/advanced/calendar) enabled in the Apps Script project

### Configuration

In `Code.js`, set these constants:

- `TEAM_CALENDAR_ID` — the ID of the shared team calendar
- `GROUP_EMAIL` — email address(es) of the Google Group(s) containing team members
- `KEYWORDS` — event summary keywords to match
- `MONTHS_IN_ADVANCE` — how far ahead to scan

### First run

Run the `setup()` function from the Apps Script editor to create the time-based trigger and run the initial sync.

## Development

This project uses [clasp](https://github.com/google/clasp) to sync between the local repo and Google Apps Script.

```sh
npm install -g @google/clasp
clasp login
clasp pull    # download latest from Apps Script
clasp push    # upload local changes to Apps Script. Immediately live!
```

## Required OAuth scopes

- `calendar.readonly` — read team members' calendars
- `calendar` — write events to the shared calendar
- `script.scriptapp` — manage triggers
- `groups` — read Google Group membership
