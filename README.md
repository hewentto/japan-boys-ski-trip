# Backup of votes and comments

This branch is written by a GitHub Action (`.github/workflows/backup.yml` on `main`) every 5 minutes. Do not edit it by hand.

- `backup.json` is the full copy. The site loads it on every visit and restores anything the vote relays have lost.
- `votes.csv` and `comments.csv` are the same data as tables you can open in a spreadsheet.

Each commit is one snapshot, so the history of this branch is the history of the vote. The group chat is not backed up.
