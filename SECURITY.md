# Security Policy

Theraptly LMS is a multi-tenant compliance-training platform. We take reports
about tenant isolation, authentication, and data handling seriously.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security reports.**

Email **admin@theraptly.com** with the subject line prefixed `[SECURITY]`.

Include whatever you have:

- What you found and why you believe it is a security issue
- Steps to reproduce (a request/response pair, a script, or a short video)
- The affected URL, endpoint, or file path
- Any account or organisation IDs you used, so we can trace it in our audit log

If you need to send something sensitive, say so in your first email and we will
arrange an encrypted channel.

### What to expect

| Stage | Target |
| --- | --- |
| Acknowledgement of your report | 3 business days |
| Initial assessment and severity | 10 business days |
| Fix or documented mitigation for High/Critical | 30 days |

We will tell you what we decided and when it shipped. If we conclude something
is not a vulnerability, we will explain why rather than closing silently.

## Scope

In scope:

- The Theraptly LMS application and its API
- Authentication, session handling, and MFA
- Authorisation, role enforcement, and **cross-organisation data access**
- Data handling in uploads, exports, certificates, and generated course content

Out of scope:

- Findings that require a compromised or physically-accessed end-user device
- Denial of service through raw traffic volume
- Missing hardening headers with no demonstrated impact
- Automated-scanner output with no working proof of concept
- Third-party services we consume (report those to the provider)
- Social engineering of our staff or customers

## Please avoid

- Accessing, modifying, or exfiltrating data belonging to an organisation that
  is not yours. Use two accounts you control to demonstrate cross-tenant issues.
- Running destructive tests, or automated scans heavy enough to degrade service
  for real users.
- Publicly disclosing an issue before we have shipped a fix or agreed a date.

Report handling requires no special account. If you need a second test
organisation to demonstrate an isolation issue, ask and we will provision one.

## Safe harbour

If you make a good-faith effort to follow this policy, we will not pursue or
support legal action against you for your research, and we will treat your
report as authorised access for the purpose of investigating it. If a third
party brings action against you for activity that complied with this policy, we
will make that compliance clear.

## A note on health information

This platform is designed and operated to **not** hold protected health
information. Uploaded documents are scanned and PHI-bearing content is rejected
rather than processed. If you find a path that causes PHI to be stored,
transmitted to a third party, or exposed, we consider that **high severity** —
please report it as such and we will prioritise it accordingly.
