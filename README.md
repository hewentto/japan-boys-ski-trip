# Japan Boys Ski Trip

Group plan and voting page for Feb 6-21, 2027.

The site is the single file `index.html`, served by GitHub Pages from the `gh-pages` branch.

## How the page is organised

1. **Your turn** and **The plan right now**: what is needed from you this week, and the big picture.
2. **Voting now**: the decision cards for the current round. Later rounds are folded under "Coming up".
3. **Explore**: one folded row per stop. Hearts only, nothing here blocks anything.
4. **Costs, booking and feedback**: the calculator, booking order, fares, proposals board and sources.

## Changing the rounds

The schedule lives in the `ROUNDS` block near the middle of the script in `index.html`. Each round has a name,
a `closes` time and the list of decisions it asks. When a deadline passes, that round's cards lock and show
the result, and the next round becomes "Voting now". To overrule a result, add `result:{ dates:"dates-a" }`
to that round.

The five ideas shown first at each stop are in the `TOP` block right below it.

## Votes and comments

Votes and comments sync between visitors through public MQTT relays. A GitHub Action on the `main` branch
(`.github/workflows/backup.yml`) copies them into the `backup` branch every 5 minutes, and the page loads
`backup.json` from that branch on every visit, so anything a relay loses is restored. The group chat is not backed up.

Item ids never change between drafts, so earlier votes and comments carry over.

## Unread

The bell in the top bar counts chat messages, chat questions, replies to you, and comments, proposals and ideas
from other people that you haven't seen yet. The same count shows on the Your turn board and in the tab title,
and a pop-up appears when something new arrives while the page is open. Browser alerts are opt-in from the bell
panel and only fire while the page is open in a tab; phones generally don't support them.

What you've read is kept per device in the browser (`jbst.chatSeen` and `jbst.readNotes`), so reading on your
phone doesn't clear the count on your laptop. A comment counts as read once it has been on screen for a moment.
