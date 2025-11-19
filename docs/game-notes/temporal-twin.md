# Temporal Twin Notes

- Automated run shows the start overlay but the canvas never sends `arcade:ready`; pressing Space in the iframe is required before anything animates.
- Once started, movement feels unresponsive and the temporal anchor (Space) never spawns a clone, so the loop soft-locks on the first platform.
- Intended loop seems to involve placing an anchor, navigating hazards, then rewinding to the anchor to bypass gates before the boss phases.
- Need to delay the ready handshake until the canvas renders the player sprite, and only start the encounter after Space is pressed.
- Next pass should instrument anchor state, surface anchor cooldown indicators, and re-run the health scan before flipping status back from `broken`.
