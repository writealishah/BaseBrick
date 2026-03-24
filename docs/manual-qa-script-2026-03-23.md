# Manual QA Script (Base-Ready Mobile)

Date: 2026-03-23  
Target: phone + Base app webview + local backend (`http://localhost:8787`)

Use frontend URL: `http://localhost:4187/index.html?v=20260323e`

## Flow 1: Guest-First Open -> Play

Steps:
1. Open app URL on phone.
2. Confirm top chip shows `v6 Cartridge`.
3. Tap `Play Now`.
4. Launch ball and play 1 short run.

Pass criteria:
- No wallet/auth popup before user requests competitive action.
- Game starts within 1 tap from home.
- Controls respond without accidental launch spam.

## Flow 2: Wallet Connect + Base Network

Steps:
1. Return Home.
2. Open optional profile card.
3. Tap `Connect Wallet`.
4. Tap `Switch To Base` if needed.

Pass criteria:
- Wallet connects cleanly.
- Profile status shows connected address.
- Chain shows Base after switch.

## Flow 3: SIWE Auth

Steps:
1. In profile card, tap `Authenticate`.
2. Accept signature prompt.

Pass criteria:
- Auth succeeds without app freeze.
- Auth status changes to verified session active.

## Flow 4: Verified Submit

Steps:
1. Start run and finish any score.
2. On result screen tap `Submit Verified Score`.

Pass criteria:
- Submit success toast appears.
- Status says verified submit sent.
- No misleading "global" text if backend unavailable.

## Flow 5: Leaderboard Readability (Narrow Screen)

Steps:
1. Open leaderboard from home or result.
2. Check rank, name, score readability.

Pass criteria:
- Text not clipped.
- Score and metadata readable without zoom.
- Mode note is honest (`verified` vs fallback).

## Flow 6: Reward Claim Trust States

Steps:
1. (If stage 20 reached) tap `Claim OG Brick Badge`.
2. If sync fails, tap retry.

Pass criteria:
- State text matches truth (`pending`, `synced`, `failed`, `local-only`).
- Retry works for failed sync.
- No false “already claimed forever” lock from local-only state.

## Flow 7: Share + Replay Loop

Steps:
1. On result, tap `Share Score`.
2. Tap `Play Again`.

Pass criteria:
- Share works (native or clipboard fallback).
- Replay is immediate and clearly primary CTA.

## Flow 8: Safe-Area + Touch Targets

Steps:
1. Test portrait with device notch.
2. Interact with bottom CTAs and controls.

Pass criteria:
- No important button hidden behind safe-area.
- Primary buttons are easy thumb taps.

## Quick Result Template

Record each flow as:

- `F1 PASS/FAIL - note`
- `F2 PASS/FAIL - note`
- `F3 PASS/FAIL - note`
- `F4 PASS/FAIL - note`
- `F5 PASS/FAIL - note`
- `F6 PASS/FAIL - note`
- `F7 PASS/FAIL - note`
- `F8 PASS/FAIL - note`

