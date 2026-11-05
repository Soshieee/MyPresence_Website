export const HELP_CATEGORIES = [
  "Getting Started",
  "Dashboard",
  "Member Management",
  "Attendance Scanning",
  "Event Management",
  "Polls and Calendar",
  "Records and Analytics",
  "Account and Settings",
  "Troubleshooting and FAQs"
] as const;

export type HelpCategory = (typeof HELP_CATEGORIES)[number];
export type HelpAudience = "all" | "admin";

export type HelpArticle = {
  id: string;
  category: HelpCategory;
  title: string;
  description: string;
  steps: string[];
  audience: HelpAudience;
};

export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: "first-sign-in",
    category: "Getting Started",
    title: "Sign in for the first time",
    description: "Use the approved account email and password to open the MyPresence dashboard.",
    steps: [
      "Open the MyPresence login page.",
      "Enter the email address and password connected to your approved account.",
      "Select Enter Dashboard.",
      "If your account is still waiting for administrator review, wait for the next steps from your church administrator or contact them directly."
    ],
    audience: "all"
  },
  {
    id: "navigation",
    category: "Getting Started",
    title: "Find your way around",
    description: "The sidebar on desktop and the shortcut row on mobile lead to every major workspace.",
    steps: [
      "Use Home for the dashboard overview.",
      "Use Register to add a member and enroll a face descriptor.",
      "Use Scan to record attendance.",
      "Use Records to review attendance history.",
      "Use Events, Members, Settings, and Help for the remaining tools."
    ],
    audience: "all"
  },
  {
    id: "restart-tour",
    category: "Getting Started",
    title: "Restart the walkthrough",
    description: "The optional first-login tour can be reopened at any time from the Help Center.",
    steps: [
      "Open Help from the sidebar.",
      "Select Restart walkthrough at the top of the page.",
      "Use Next and Previous to move through the steps, or Skip to close it."
    ],
    audience: "all"
  },
  {
    id: "dashboard-overview",
    category: "Dashboard",
    title: "Read the dashboard overview",
    description: "Home summarizes attendance, upcoming events, and quick links.",
    steps: [
      "Open Home.",
      "Review the attendance and member summary cards.",
      "Check the calendar and upcoming events for the next service or gathering.",
      "Use the quick links to jump directly to scanning, records, or events."
    ],
    audience: "all"
  },
  {
    id: "add-member",
    category: "Member Management",
    title: "Register a member",
    description: "Add a member profile and capture the face descriptor used by the attendance scanner.",
    steps: [
      "Open Register from the sidebar.",
      "Enter the member details requested by the form.",
      "Confirm that the member, or their parent or guardian, agrees to face enrollment.",
      "Allow camera access, align the face with the guide, and capture the descriptor.",
      "Save the member and check that the confirmation appears."
    ],
    audience: "all"
  },
  {
    id: "edit-member",
    category: "Member Management",
    title: "Edit or deactivate a member",
    description: "Keep member details current and remove inactive people from scanning without deleting their history.",
    steps: [
      "Open Members.",
      "Search for the member by name or member ID.",
      "Open the member record and update the available details.",
      "Use the active/inactive control when a member should no longer be scanned.",
      "Save the changes and verify the updated status."
    ],
    audience: "all"
  },
  {
    id: "member-history",
    category: "Member Management",
    title: "Review a member's history",
    description: "Inspect attendance and profile history before correcting a record.",
    steps: [
      "Open Members and select the member.",
      "Open the history or detail panel.",
      "Review recent attendance entries and any linked events.",
      "If a correction is needed and the control is unavailable, contact an administrator."
    ],
    audience: "all"
  },
  {
    id: "delete-member",
    category: "Member Management",
    title: "Delete a member record",
    description: "Administrators can permanently remove a member and the related attendance records.",
    steps: [
      "Open Members and search for the member.",
      "Open the member record and choose the delete option.",
      "Read the warning and confirm that the member and linked attendance should be removed.",
      "Confirm the deletion and refresh the directory."
    ],
    audience: "admin"
  },
  {
    id: "scan-attendance",
    category: "Attendance Scanning",
    title: "Scan attendance",
    description: "Record a member's attendance for a service or event using the camera scanner.",
    steps: [
      "Open Scan from the sidebar.",
      "Choose the attendance type, date, and linked event or service where applicable.",
      "Allow camera access when the browser asks.",
      "Align the member's face with the on-screen guide.",
      "Wait for the recognition result and confirm the attendance entry.",
      "Use the duplicate warning instead of scanning the same person repeatedly."
    ],
    audience: "all"
  },
  {
    id: "camera-permission",
    category: "Attendance Scanning",
    title: "Fix camera access",
    description: "The scanner needs browser camera permission and a secure connection.",
    steps: [
      "Check the browser address bar for a blocked camera icon and allow access.",
      "Close other apps that may be using the camera.",
      "Reload the page and try again.",
      "Use a supported browser and an HTTPS connection.",
      "If the camera still fails, try another device and contact an administrator."
    ],
    audience: "all"
  },
  {
    id: "correct-attendance",
    category: "Attendance Scanning",
    title: "Correct an attendance entry",
    description: "Review the record before changing anything so the history stays consistent.",
    steps: [
      "Open Records.",
      "Filter to the relevant date, service, network, or event.",
      "Find the member's attendance entry and check the timestamp.",
      "Use the available correction control if one is provided.",
      "If the page does not allow the correction, ask an administrator to update it."
    ],
    audience: "all"
  },
  {
    id: "create-event",
    category: "Event Management",
    title: "Create an event",
    description: "Events connect attendance to a specific service, gathering, or activity.",
    steps: [
      "Open Events from the sidebar.",
      "Start a new event and enter the title, date, time, and event type.",
      "Add the location, description, poster, or hashtags where appropriate.",
      "Save the event and confirm that it appears in the event list and calendar."
    ],
    audience: "all"
  },
  {
    id: "edit-event",
    category: "Event Management",
    title: "Edit or delete an event",
    description: "Update event details or remove an event when it is no longer needed.",
    steps: [
      "Open Events and select the event.",
      "Choose the edit action and update the details.",
      "Save the changes and check the calendar.",
      "To remove an event, use the delete action and read the confirmation warning first."
    ],
    audience: "admin"
  },
  {
    id: "create-poll",
    category: "Polls and Calendar",
    title: "Create and publish a poll",
    description: "Polls can collect responses for an event or church decision.",
    steps: [
      "Open Events and select the relevant event.",
      "Open the poll section and add the question and answer choices.",
      "Set the schedule or status if the form provides those controls.",
      "Publish the poll and review the results after responses arrive."
    ],
    audience: "all"
  },
  {
    id: "calendar",
    category: "Polls and Calendar",
    title: "Keep the calendar accurate",
    description: "The calendar reflects event dates and helps the team avoid scheduling conflicts.",
    steps: [
      "Create or update the event before changing its calendar details.",
      "Check the event date, time, and type.",
      "Refresh the calendar after saving.",
      "Remove or archive events that should no longer appear."
    ],
    audience: "all"
  },
  {
    id: "records-filters",
    category: "Records and Analytics",
    title: "Filter and review records",
    description: "Use the record filters to answer a specific attendance question.",
    steps: [
      "Open Records.",
      "Choose the date range you need.",
      "Add the network, service, event, or member filter where available.",
      "Review the filtered totals and individual entries.",
      "Export or print only the data you are authorized to share."
    ],
    audience: "all"
  },
  {
    id: "analytics",
    category: "Records and Analytics",
    title: "Understand analytics",
    description: "Analytics summarize the records currently loaded by the filters.",
    steps: [
      "Apply the date and service filters first.",
      "Review the summary cards and chart labels.",
      "Check the underlying records when a number looks unexpected.",
      "Do not compare reports that use different filters or date ranges."
    ],
    audience: "all"
  },
  {
    id: "account-settings",
    category: "Account and Settings",
    title: "Update account and scan settings",
    description: "Settings shows your current session and stores scan preferences in this browser.",
    steps: [
      "Open Settings.",
      "Review the account email, user ID, and last sign-in time.",
      "Adjust the newcomer scan preference if needed.",
      "Select Save Settings.",
      "Use Sign Out when you are finished on a shared device."
    ],
    audience: "all"
  },
  {
    id: "password-reset",
    category: "Account and Settings",
    title: "Reset your password",
    description: "Request a reset code from the login page and choose a new password.",
    steps: [
      "Open the login page and select Forgot Password.",
      "Enter your account email and send the reset code.",
      "Enter the code from the email.",
      "Choose a new password with at least eight characters.",
      "Return to login and sign in with the new password."
    ],
    audience: "all"
  },
  {
    id: "admin-unlock",
    category: "Account and Settings",
    title: "Unlock a locked account",
    description: "Administrators can clear a temporary login lockout from Settings.",
    steps: [
      "Open Settings with an approved administrator account.",
      "Find the Account Security or Unlock Account section.",
      "Enter the locked user's email address.",
      "Select Unlock Account.",
      "Ask the user to sign in again. The unlock is recorded in the security log."
    ],
    audience: "admin"
  },
  {
    id: "camera-or-face-scan",
    category: "Troubleshooting and FAQs",
    title: "The camera or face scan is not working",
    description: "Camera permission, lighting, and face position are the most common causes.",
    steps: [
      "Check the browser address bar for a blocked camera icon and allow camera access.",
      "Close other apps that may be using the camera, then reload the page.",
      "Use a supported browser and an HTTPS connection.",
      "Improve the lighting and ask the member to face the camera and hold still.",
      "If the scanner still fails, confirm that the member is active and enrolled, then contact an administrator."
    ],
    audience: "all"
  },
  {
    id: "locked-out",
    category: "Troubleshooting and FAQs",
    title: "I am locked out of my account",
    description: "Five consecutive failed attempts trigger a temporary 15-minute lockout.",
    steps: [
      "Wait for the countdown or retry period to finish.",
      "Check that Caps Lock is off and the email is correct.",
      "Use Forgot Password if you do not remember the password.",
      "Ask an administrator to unlock the account if you cannot wait.",
      "Do not create a second account to bypass the lockout."
    ],
    audience: "all"
  },
  {
    id: "account-approval-pending",
    category: "Troubleshooting and FAQs",
    title: "My account is still waiting for approval",
    description: "Website administrator accounts are reviewed before access is granted.",
    steps: [
      "Confirm that you verified your email address after registering.",
      "Wait for an administrator to review the account application.",
      "Check your spam or promotions folder for messages from the church or MyPresence.",
      "Contact a staff member or MyPresence administrator if the review is taking longer than expected."
    ],
    audience: "all"
  },
  {
    id: "reset-email-missing",
    category: "Troubleshooting and FAQs",
    title: "The reset email did not arrive",
    description: "The reset page confirms verified accounts only and says so when an email is unknown.",
    steps: [
      "If the page shows No account found for that email, check the address for typos.",
      "Check the spam, promotions, and trash folders.",
      "Confirm that the email address matches the account.",
      "Wait a few minutes before requesting another code.",
      "Try again later if the request limit was reached.",
      "Contact an administrator if the account email may be incorrect."
    ],
    audience: "all"
  },
  {
    id: "duplicate-attendance",
    category: "Troubleshooting and FAQs",
    title: "A duplicate attendance warning appears",
    description: "The scanner prevents the same member from being recorded repeatedly for the same service.",
    steps: [
      "Stop scanning the same person.",
      "Open Records and confirm the existing entry.",
      "Check whether the member was already recorded under another service or event.",
      "Contact an administrator if the existing entry is wrong."
    ],
    audience: "all"
  }
];
