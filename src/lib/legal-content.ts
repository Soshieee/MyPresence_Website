export type LegalBlock =
  | { type: "paragraph"; text: string }
  | { type: "bullets"; items: string[] };

export type LegalSection = {
  id: string;
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  content?: LegalBlock[];
};

export const TERMS_LAST_UPDATED = "November 6, 2026";
export const PRIVACY_LAST_UPDATED = "November 5, 2026";

export const termsSections: LegalSection[] = [
  {
    id: "acceptance",
    title: "1. Acceptance of Terms",
    content: [
      {
        type: "paragraph",
        text: "By accessing or using MyPresence (the \"Service\"), you agree to be bound by these Terms and Conditions (\"Terms\"). If you do not agree to these Terms, please do not use the Service."
      }
    ]
  },
  {
    id: "purpose",
    title: "2. Purpose of the Service",
    content: [
      {
        type: "paragraph",
        text: "MyPresence is a website designed to support event management activities and attendance monitoring for events organized by HPCI Thrive. The website allows registered users to:"
      },
      {
        type: "bullets",
        items: [
          "View event schedules and announcements.",
          "Review event details, calendars, and polls where available.",
          "Record or manage attendance using facial recognition technology.",
          "Receive event-related updates in the website."
        ]
      }
    ]
  },
  {
    id: "accounts",
    title: "3. User Registration and Account Responsibility",
    content: [
      {
        type: "paragraph",
        text: "You may need to create an account to access certain features of the website. By registering, you agree to:"
      },
      {
        type: "bullets",
        items: [
          "Provide accurate and complete information.",
          "Maintain the confidentiality of your login credentials.",
          "Notify administrators immediately of any unauthorized use of your account."
        ]
      },
      {
        type: "paragraph",
        text: "You are responsible for all activities conducted under your account."
      }
    ]
  },
  {
    id: "biometric",
    title: "4. Facial Recognition and Biometric Data",
    content: [
      {
        type: "paragraph",
        text: "To improve attendance monitoring efficiency, MyPresence may collect and process facial recognition data for attendance features. By using these features, you acknowledge and consent to the following:"
      },
      {
        type: "bullets",
        items: [
          "Facial images may be captured during member registration or attendance verification.",
          "The facial recognition system compares captured images with stored facial descriptors to help confirm identity.",
          "Biometric data is used solely for attendance monitoring and event management purposes."
        ]
      },
      {
        type: "paragraph",
        text: "The organization will take reasonable steps to ensure that biometric data is securely stored and protected against unauthorized access. Removing a face descriptor may prevent automatic face-based attendance."
      }
    ]
  },
  {
    id: "privacy",
    title: "5. Data Privacy and Protection",
    content: [
      {
        type: "paragraph",
        text: "MyPresence is designed to handle personal data in line with applicable data protection laws and HPCI Thrive's internal data privacy policies. Personal data collected through the website may include:"
      },
      {
        type: "bullets",
        items: [
          "Name.",
          "Contact information.",
          "Event participation records.",
          "Facial recognition data."
        ]
      },
      {
        type: "paragraph",
        text: "This information will only be used for event administration, attendance verification, and communication related to HPCI Thrive activities. See the Privacy Notice for more details."
      }
    ]
  },
  {
    id: "conduct",
    title: "6. User Conduct",
    content: [
      {
        type: "paragraph",
        text: "You agree not to:"
      },
      {
        type: "bullets",
        items: [
          "Attempt to bypass or manipulate the facial recognition system.",
          "Use another person's identity to register or record attendance.",
          "Share login credentials with unauthorized individuals.",
          "Engage in any activity that disrupts the website's functionality or security."
        ]
      }
    ]
  },
  {
    id: "intellectual-property",
    title: "7. Intellectual Property",
    content: [
      {
        type: "paragraph",
        text: "MyPresence and its original content, features, and functionality remain the exclusive property of HPCI Thrive and its licensors. The website is protected by copyright, trademark, and other laws."
      }
    ]
  },
  {
    id: "liability",
    title: "8. Limitation of Liability",
    content: [
      {
        type: "paragraph",
        text: "In no event shall HPCI Thrive, nor its directors, employees, partners, agents, suppliers, or affiliates, be liable for any indirect, incidental, special, consequential, or punitive damages, including without limitation loss of profits, data, use, goodwill, or other intangible losses, resulting from:"
      },
      {
        type: "bullets",
        items: [
          "Your use of the website.",
          "Any unauthorized access to or use of our servers and/or any personal information stored therein.",
          "Any interruption or cessation of transmission to or from the website.",
          "Any bugs, viruses, trojan horses, or the like that may be transmitted to or through the website by any third party.",
          "Any errors or omissions in any content or for any loss or damage incurred as a result of the use of any content posted, emailed, transmitted, or otherwise made available through the website."
        ]
      }
    ]
  },
  {
    id: "termination",
    title: "9. Termination",
    content: [
      {
        type: "paragraph",
        text: "We may terminate or suspend your account and bar access to the website immediately, without prior notice or liability, at our sole discretion, for any reason whatsoever and without limitation, including but not limited to a breach of these Terms."
      }
    ]
  },
  {
    id: "changes",
    title: "10. Changes to Terms",
    content: [
      {
        type: "paragraph",
        text: "We reserve the right, at our sole discretion, to modify or replace these Terms at any time. If a revision is material, we will post the updated Terms on this page at least 30 days before the new Terms take effect. What constitutes a material change will be determined at our sole discretion."
      }
    ]
  },
  {
    id: "contact",
    title: "11. Contact Information",
    content: [
      {
        type: "paragraph",
        text: "If you have any concerns about these Terms and Conditions, please inform a staff member of HPCI Thrive or the MyPresence administrator who manages your account."
      }
    ]
  }
];

export const privacySections: LegalSection[] = [
  {
    id: "scope",
    title: "1. Scope of This Notice",
    paragraphs: [
      "This Privacy Notice explains how the MyPresence website handles personal information for attendance, member management, events, polls, verification, and related church administration.",
      "It describes the current website implementation. It does not create a certification of compliance with the GDPR, BIPA, RA 10173, or any other privacy law."
    ]
  },
  {
    id: "collected",
    title: "2. Personal Information We Collect",
    bullets: [
      "Account information: email address, first and last name, authentication metadata, and last sign-in time.",
      "Member information: member or student ID, full name, age, gender, newcomer status, active status, and profile details.",
      "Face data: a numerical face descriptor generated from a webcam image for recognition. The attendance scanner does not intentionally upload the live camera image into the member record.",
      "Attendance information: date, time, attendance type, group, service, linked event, and newcomer snapshot.",
      "Event and poll information: event details, poster images, poll choices and submissions, and calendar data.",
      "Lifegroup information: membership, roles, RSVPs, and activity records where those features are used.",
      "Verification information: submitted profile information, social posts, profile pictures, leader requests, and reviewer notes.",
      "Technical and security information: browser session data, local preferences, hashed email lockout records, and security event timestamps."
    ],
    paragraphs: [
      "Passwords are handled by Supabase Auth. MyPresence does not store plaintext passwords."
    ]
  },
  {
    id: "purposes",
    title: "3. Why We Collect and Use Information",
    bullets: [
      "Authenticating users and reviewing account applications.",
      "Maintaining member records and recording attendance.",
      "Managing events, polls, calendars, lifegroups, and related church activities.",
      "Producing attendance records, analytics, and administrative reports.",
      "Reviewing verification submissions and leader requests.",
      "Protecting accounts through login lockout, rate limits, and security monitoring.",
      "Responding to support requests and correcting inaccurate records."
    ]
  },
  {
    id: "processing",
    title: "4. How Information Is Processed and Stored",
    paragraphs: [
      "MyPresence uses Supabase for database, authentication, and storage services. The website hosting environment processes requests and server-side authentication operations. Authentication emails are sent through Supabase Auth and its configured email provider.",
      "The current website code does not include third-party advertising or analytics trackers. Browser storage is used for the Supabase session and local preferences such as onboarding completion and scan settings."
    ]
  },
  {
    id: "access",
    title: "5. Who Can Access Information",
    paragraphs: [
      "Access is intended for authorized church administrators with approved accounts and for service providers that process data on the church's behalf. MyPresence does not sell member data.",
      "Administrative features are intended for approved administrators only. The church is responsible for reviewing administrator accounts and the Supabase access policies configured for its deployment."
    ]
  },
  {
    id: "retention",
    title: "6. Data Retention",
    paragraphs: [
      "The current implementation does not automatically expire member, attendance, or verification records. Those records remain until an administrator deletes them or replaces the relevant data.",
      "Face descriptors remain until the member is deleted or re-enrolled. Poll and event data remain with the related event or poll. Login security records are kept only for lockout enforcement and are pruned periodically."
    ],
    bullets: [
      "Member and attendance records: until an administrator deletes the member or record.",
      "Face descriptors: until the member is deleted or the descriptor is replaced.",
      "Verification records: until an administrator deletes them.",
      "Login security records: pruned periodically after they are no longer needed for lockout enforcement.",
      "Backups: retained according to the hosting and database provider's backup settings."
    ]
  },
  {
    id: "security",
    title: "7. Security Measures",
    paragraphs: [
      "MyPresence uses HTTPS transport, Supabase Auth for password handling, server-side login lockout, and a service-role key that is restricted to server routes. Administrator features are intended for approved accounts.",
      "Database access rules should be configured and reviewed in Supabase for each deployment. MyPresence does not claim application-layer encryption of face descriptors. No system can guarantee complete security."
    ]
  },
  {
    id: "rights",
    title: "8. Your Rights and Choices",
    paragraphs: [
      "You may ask to access, correct, or delete your personal information, or request deletion of your face descriptor. Removing a descriptor may prevent automatic face-based attendance. Some records may need to be retained for church administration, security, or legal reasons.",
      "To make a request, contact your church office or the MyPresence administrator. The church may ask you to verify your identity before acting on a request."
    ]
  },
  {
    id: "minors",
    title: "9. Children and Minors",
    paragraphs: [
      "Members who are minors should be enrolled only with the consent of a parent or guardian and with church authorization. Parents and guardians may contact the church office to ask about a minor's records or to request deletion of the minor's face descriptor."
    ]
  },
  {
    id: "changes",
    title: "10. Changes and Contact",
    paragraphs: [
      "This notice may be updated as MyPresence changes. The Last updated date at the top of this page will be revised when changes are made.",
      "For privacy questions or concerns, contact your church office or the MyPresence administrator who manages your account."
    ]
  }
];
