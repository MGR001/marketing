# Deploy to Render Free with Git auto-deploys

This setup uses Render's regular **Web Service** flow, not a Blueprint. The service connects to GitHub and automatically redeploys when `main` changes. Render uses the repository's `Dockerfile` to build the Node.js app and optional CrewAI runtime.

## Create the service

1. In Render, choose **New → Web Service** (not Blueprint).
2. Connect GitHub and select `MGR001/marketing`, branch `main`.
3. Choose **Docker** as the runtime and **Free** as the instance type. Keep the Dockerfile path as `./Dockerfile` and Docker context as `.`.
4. Set the health-check path to `/health` if the form offers it.
5. Add these environment variables under **Advanced → Environment Variables**:
   - `NODE_ENV` = `production`
   - `APP_BASIC_AUTH_USER` = a username you choose
   - `APP_BASIC_AUTH_PASSWORD` = a strong, unique password
   - `OPENAI_API_KEY` = your provider key (needed only for AI generation)
   - `OPENAI_MODEL` = `openai/gpt-4o-mini` (optional; this is the app default)
   - `CREWAI_PYTHON` = `/opt/crew-env/bin/python` (the Dockerfile default)
6. Click **Create Web Service**. In **Settings → Build & Deploy**, leave auto-deploy enabled for `main` (typically **On Commit**).

The Dockerfile supplies the start command (`npm start`) and binds to Render's port. Do not set a `DATA_DIR` mount expecting persistence on Free.

## Free-tier limitations

- Git auto-deploy syncs **code** from GitHub; it does not commit edits made in the timeline editor back to GitHub.
- Render Free has an ephemeral filesystem. Timeline edits, agent-profile edits, saved runs, and human approvals can be lost on restarts, deploys, or when the service spins down after 15 minutes without traffic. The app reseeds from the JSON files included in the deployed commit. Keep important changes in local backups/Git yourself.
- The Free instance has 512 MB RAM and may spin up slowly after idle. The basic timeline and editor should be suitable for a small test; CrewAI generation may exceed the free instance's memory or time limits. OpenAI API usage may also incur charges.
- Render provides 750 free instance-hours per workspace each month; usage and other free-tier limits apply. Free hosting is best-effort, not production-grade.

## Security

The app requires `APP_BASIC_AUTH_USER` and `APP_BASIC_AUTH_PASSWORD` in production. Keep credentials and API keys in Render's environment settings, never in GitHub or chat. If an API key has been exposed, revoke it with the provider and replace it before deploying.
