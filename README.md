# Japan Boys Ski Trip

Group itinerary and voting page for Feb 6-21, 2027.

The site is the single file `index.html`, served by GitHub Pages from the `gh-pages` branch.

Votes and comments sync between visitors through public MQTT relays. A GitHub Action on the `main` branch
(`.github/workflows/backup.yml`) copies them into the `backup` branch every 5 minutes, and the page loads
`backup.json` from that branch on every visit, so anything a relay loses is restored. The group chat is not backed up.
