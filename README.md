# Hackathon Progress Backend

This project runs a static frontend and a Node/Express backend that persists team progress.

The frontend is compatible with GitHub Pages, but it needs a separately hosted backend URL for login and sync. Use the backend URL field on the login screen to point the app at your deployed API.

Quick setup (local MongoDB):

1. Start a MongoDB instance. Easiest via Docker:

```bash
# Linux / macOS / Windows (WSL)
docker run -d -p 27017:27017 --name hackathon-mongo -v hackathon-mongo-data:/data/db mongo:6
```

2. Install dependencies and start servers:

```powershell
npm install
npm run backend    # starts Express backend on port 3001
npm run serve      # serves frontend at http://localhost:3000
```

3. Open the frontend and enter a backend URL before logging in.

4. Sign in with:

```text
Leader: adisoni01 / A12528@as
```

The leader can create member accounts, reset passwords, and view all team progress. Members only see their own checklists.

Environment variables:
- `MONGO_URI` (default: `mongodb://localhost:27017`)
- `MONGO_DB` (default: `hackathon`)
- `MONGO_COLLECTION` (default: `progress`)

Optional write protection:
- `WRITE_TOKEN` : if set on the server, all write endpoints (`POST /api/state`, `POST /api/member/:id/task`) require the token to be sent in the `x-write-token` header (or `?token=` query) to succeed.

Frontend token key:
- The frontend can save a write token in localStorage under `aios_backend_token` (set via the leader controls) and the client will send it as `x-write-token` when performing syncs.

Backend URL key:
- The frontend saves the API base URL in localStorage under `aios_backend_origin`.
- On GitHub Pages, set this once on the login screen to the URL of your hosted backend, for example `https://your-api.example.com`.

If MongoDB is not available, the server will fall back to a local `progress.json` file.

Deployment notes for GitHub Pages:
- Host `index.html` on GitHub Pages.
- Host `server.js` separately on a Node platform that supports Express and MongoDB.
- Make sure the backend has CORS enabled for your GitHub Pages domain.

Render deployment:
1. Create a new Web Service on Render from this repository.
2. Set the build command to `npm install`.
3. Set the start command to `npm start`.
4. Add environment variables on Render:
	- `MONGO_URI` = your MongoDB Atlas connection string
	- `MONGO_DB` = `hackathon`
	- `MONGO_COLLECTION` = `progress`
	- `MONGO_USERS_COLLECTION` = `users`
	- `WRITE_TOKEN` = optional write-protection token
5. Deploy and copy the Render service URL.

Connect Render to GitHub Pages:
1. Open the GitHub Pages site.
2. Paste the Render backend URL into the `Backend URL` field on the login screen.
3. Click `SAVE BACKEND URL`.
4. Wait for the status message to show `Backend status: connected`.
5. Log in with the leader account, then create the member accounts from the leader panel.
# NewWeb_AIOS
