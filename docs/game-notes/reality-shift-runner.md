# Reality Shift Runner Notes

- Headless smoke test reaches the intro overlay, but pressing Begin immediately returns an "OUT OF TIME" banner before the player can move.
- The runner ignores Arrow/A/D input even though the input manager toggles flags; the timer keeps counting down to zero.
- Core loop appears to hinge on jumping to rotate gravity (`rotateWorld`) while racing the clock toward the glowing exit portal.
- Investigate why `arcade:ready` never fires under automation; the bridge waits for a canvas but the scene may not render until focus/interaction.
- Plan to pause the countdown until the first successful input and instrument a visible tutorial for the gravity flip.
- Once stability is confirmed, re-enable the manifest entry from its temporary `broken` state.
