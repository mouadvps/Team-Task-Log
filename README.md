# Team Task Log (Firebase + GitHub Pages)

Files: `index.html` (the dashboard), `firebase-config.js` (your Firebase settings), `firestore.rules` (security rules).

## 1. Create the Firebase project (free Spark plan)
1. Go to https://console.firebase.google.com and click **Add project**.
2. **Build > Authentication > Get started > Email/Password > Enable.**
3. **Authentication > Users > Add user**: create one account (email + password) for each team member.
4. **Build > Firestore Database > Create database** (production mode, pick a region close to you).
5. In Firestore open the **Rules** tab, paste the contents of `firestore.rules`, click **Publish**.
6. **Project settings (gear) > Your apps > Web (</>)**: register an app. Copy the config values into `firebase-config.js`.

## 2. Put it on GitHub Pages
1. Create a new repository on GitHub.
2. **Add file > Upload files**: upload `index.html`, `firebase-config.js`, `firestore.rules`, then commit.
3. **Settings > Pages**: Source = "Deploy from a branch", Branch = `main`, folder = `/ (root)`, Save.
4. After a minute GitHub shows the site link. Share it with the team.

## 3. Allow the site domain in Firebase
**Authentication > Settings > Authorized domains > Add domain**: `YOUR-USERNAME.github.io`.

## Notes
- The link is public, but nobody can see or change tasks without signing in with an account you created.
- To remove someone: Authentication > Users > delete the account.
- The PDF report button downloads a PDF for the selected period.
- Categories and team names are free text with suggestions; add more suggestions in `index.html` (search for "Helpdesk").
