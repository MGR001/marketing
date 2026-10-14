# Deploy to Render

This project is configured as a Docker-based Render Web Service. The Blueprint file is `render.yaml`.

## 1. Push the project to GitHub

Push the project, including `Dockerfile`, `.dockerignore`, `render.yaml`, and this guide, to the GitHub branch Render should deploy. Do not commit `.env` or real API credentials.

## 2. Create the Render service

1. In Render, choose **New → Blueprint** and connect `MGR001/marketing`.
2. Select the `main` branch and apply the Blueprint from `render.yaml`.
3. Choose/retain the **Starter** plan or higher. A persistent disk is included in this configuration; Render does not provide persistent disks on its free web-service plan.
4. During setup, enter `APP_BASIC_AUTH_USER`, a long unique `APP_BASIC_AUTH_PASSWORD`, and `OPENAI_API_KEY` when prompted for unsynced environment variables. Keep these values private. `OPENAI_MODEL` defaults to `openai/gpt-4o-mini`.

The Blueprint builds Node.js and the CrewAI Python environment into one Docker image, listens on Render's assigned port, protects the app with HTTP Basic Authentication, and mounts a 1 GB persistent disk at `/var/data` for the timeline, agent profiles, and saved runs. On the first deploy, the app seeds missing files on the disk from the included `data/` defaults; later deploys preserve the disk's contents.

## 3. Open the service

Wait for the deploy and `/health` check to pass, then open the `onrender.com` service URL. The browser will prompt for the Basic Auth username and password. The timeline editor, reports, and AI workbench all use the same sign-in. AI generation uses the configured provider key and may incur charges.

## Notes

- This is a single-user access gate, not per-user accounts or an audit trail. Use a strong, unique password and share it only with intended users.
- The app data disk is persistent but is not a backup. Download/copy important data backups separately.
- Never add `.env`, passwords, or API keys to GitHub. The Docker build explicitly excludes local environment files.
