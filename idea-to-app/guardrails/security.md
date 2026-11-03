# Guardrail 1 — Security

**The principle:** an app is only as trustworthy as the worst thing a stranger
can do with it. Security cannot be added at the end, so these ten rules apply
from the first screen.

Read this before you scaffold the project, and again at the Stage 3 review.
Report against it in plain English: what you checked, what you found, what you fixed.

## The ten rules

### 1. Secrets never touch the code
Passwords, API keys and database addresses live in the host's environment
settings, typed in by the owner. **Check:** search the whole repository for keys
before every ship. `.env` files stay out of version control.

### 2. Every input is a stranger's input
Checks on the screen are a courtesy to honest people. The check that matters
runs on the server, where nobody can skip it. **Check:** a test that sends bad
data straight to the server, past the screen.

### 3. People see only their own data
Every request that returns data asks "is this person allowed this?" on the
server, every time. Hiding a button is not security. **Check:** try to open one
person's record while signed in as another.

### 4. Close the doors you did not mean to open
No debug pages, no test accounts, no admin screen without a login, no database
open to the internet. **Check:** list every route and every table rule, and say
who can reach each one.

### 5. Never hand-roll the front door
If the app needs logins, use a proven login service. Do not invent password
storage, password reset or session handling. **Check:** name the service used,
and confirm no password is stored by the app itself.

### 6. Do not log people
Names, emails, phone numbers and anything about health or money stay out of
logs and error reports. **Check:** read a real log line aloud and confirm there
is nothing in it you would mind a stranger reading.

### 7. Limit how often anyone can knock
Every form, upload, search and paid call behind a public page gets a rate limit.
This protects the app and the owner's bill at the same time. **Check:** send the
same request fifty times quickly and confirm it is refused.

### 8. Use only parts you can name
Keep the list of outside code short. Add nothing the spec does not need.
**Check:** run the dependency audit the language provides, and report known
vulnerabilities with their severity.

### 9. Fail closed and fail quietly
When something breaks, the app denies the action and shows "something went
wrong". Error details go to the owner's logs, never to the visitor's screen.
**Check:** force an error and read what a visitor sees.

### 10. Write down what you checked
Only facts you verified this session go on the Trust Card. An unverified claim
is worse than no claim. **Check:** every row on the Trust Card names a date and
a result.

## What AI-written code gets wrong most often

Name these out loud when you review. They are the failures that reach
production in AI-built apps, and the learner should know you looked for them:

- A permission check on the screen, but not on the server behind it
- Validation in the browser only, so anything can be sent directly to the server
- A key pasted into code that runs in the visitor's browser, where it is public
- Database rules left wide open from the first day of setup
- Error messages that print the query, the file path or the stack trace
- No rate limit on a form, so one person can submit it ten thousand times
- A copied snippet that brings an outdated package with a known vulnerability

## What you never do

- Ask the learner to paste a password or key into the chat
- Store personal data the spec does not name
- Turn off a security check to make a test pass
- Claim a check passed without running it in this session
