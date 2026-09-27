# Chaos Link

A real-time 2–8 player party game prototype.

## Run locally
1. Install Node.js 18+.
2. In this folder run:
   npm install
   npm start
3. Open http://localhost:3000 in multiple browser windows/devices on the same reachable host.

## Game
8 rounds. Each round has:
- a social prompt
- a private mission
- a random Chaos Event
- secret answers
- prediction/missions/chaos scoring
- reveal + leaderboard

## Production
For public internet play, deploy the Node server to a WebSocket-capable host. Add persistence/authentication, reconnect handling, rate limiting, moderation, and HTTPS before a public launch.
