# Google Calendar existing-event links with multiple signed-in accounts

Date: 2026-08-30  
Scope: Google first-party documentation/help and the referenced Full Calendar repository. No Nautilus source was changed.

## Conclusion

Google Calendar's supported event link is the API-returned `event.htmlLink`. Google documents it as the read-only absolute link to that event in the Calendar Web UI; the event ID itself is opaque and calendar-scoped. Therefore Nautilus should keep the exact `htmlLink` as the canonical destination instead of rebuilding or permanently rewriting it. ([Calendar Events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events#resource))

The failure reported by the user is an account-session routing problem, not a missing event: Google says that when several accounts are signed in and a new browser window does not identify the intended account, a default account may be used; the default is often the account signed in first. ([Google Account Help: multiple sign-in](https://support.google.com/accounts/answer/1721977?hl=en))

There is no documented Calendar API parameter that binds an arbitrary `htmlLink` click to the OAuth-authorized account. The robust design is therefore two-layered:

1. Preserve and open the exact API `htmlLink`.
2. Preserve the authorized Google identity and use it for clear UI and account-aware fallback routing; never silently rely on the browser's default account.

## Comparison of candidate approaches

| Approach | Official support | Reliability | Recommendation |
|---|---|---:|---|
| Open `event.htmlLink` unchanged | Explicitly documented by Calendar API | High for the event identity; account selection remains browser-dependent | Canonical stored URL and normal destination |
| Reconstruct `calendar/event?eid=...` | Not documented as the Calendar API contract; event IDs are opaque and calendar-scoped | Lower than `htmlLink`; duplicates Google-owned URL generation | Do not make this the canonical link |
| Add `authuser=<email>` or `/u/<index>` | No Calendar deep-link input contract was found in the official Calendar/Identity docs reviewed | Index depends on the browser's current multi-login ordering; email routing is also not a documented Calendar contract | Do not persist or depend on it as the only route |
| `accounts.google.com/AccountChooser?continue=...` | Google uses account chooser flows, but this generic redirect shape is not documented as a Calendar event-link API | Useful as a compatibility fallback, but subject to web implementation changes | If used, treat as a guarded fallback around the unchanged `htmlLink`, not the canonical URL |
| OAuth `login_hint` | Explicitly documented for the OAuth authorization endpoint | Correctly selects/prefills the authorization account | Use when connecting/reconnecting after identity is known; it does not route later Calendar page clicks |
| OAuth `prompt=select_account` | Explicitly documented for the OAuth authorization endpoint | Reliably asks the user which account authorizes the plugin | Use for first connect or explicit account change; do not run OAuth on every `Open` click |
| Separate Chrome profiles | Explicitly recommended by Chrome for keeping work/personal accounts separate | Highest isolation because cookies and sessions are separated | Best user-controlled guarantee, especially for Roam Desktop opening a system browser |

Google's OAuth documentation limits `login_hint` and `prompt=select_account` to authentication/authorization requests. `login_hint` can be an email address or stable Google `sub`; `select_account` deliberately displays the account chooser. These parameters solve “which account grants access,” not “which already-authorized browser session opens this event.” ([OAuth web-server parameters](https://developers.google.com/identity/protocols/oauth2/web-server#creatingclient), [OpenID Connect parameters](https://developers.google.com/identity/openid-connect/openid-connect#authenticationuriparameters))

For a stable internal identity, Google says to key the connection by `sub`, not by email; email may change. If Nautilus needs an account label or login hint, it can request `openid email`, validate the ID token, store `sub` as identity, and use the verified email only as display/routing metadata. ([Google OpenID Connect ID-token claims](https://developers.google.com/identity/openid-connect/openid-connect#obtainuserinfo))

Chrome profiles are the only fully documented way among the compared options to isolate browser sessions for work and personal accounts. Google describes profiles specifically as a way to keep different accounts separate. ([Chrome Help: profiles](https://support.google.com/chrome/answer/2364824?hl=en))

## Recommended Nautilus behavior

1. **Canonical data:** save the API-returned `htmlLink` unchanged for every imported event.
2. **Connection identity:** at authorization time retain a stable `sub` and a verified display email when available. Do not infer the connected account from `organizer.email`: an invited/shared-calendar event may have a different organizer.
3. **Connect UX:** first connect or “Change account” uses `prompt=select_account`; reconnect for a known identity may use `login_hint`.
4. **Open UX:** label or tooltip the action with the connected account, for example `Open in Google Calendar · account@example.com`. Open the canonical `htmlLink`.
5. **Multi-account fallback:** if an account-aware `AccountChooser` wrapper is adopted, wrap only an allowlisted Google Calendar `https:` URL, URL-encode the full `htmlLink` as `continue`, and keep direct `htmlLink` as the fallback. Treat the wrapper as compatibility code with tests, because it is not a documented Calendar API surface.
6. **Do not store `/u/N`:** the ordinal is local to the browser's current sign-in order and is unsuitable as durable event metadata.
7. **No per-click OAuth:** reauthorizing with `login_hint`/`select_account` on every event click adds consent friction and does not belong to navigation.
8. **Desktop note:** when Roam Desktop opens the system browser, Nautilus cannot select a Chrome profile through a normal web URL. A dedicated Chrome profile is the strongest supported remedy when the user needs strict work/personal isolation.

This design adds no Calendar polling and no event API request at click time. The only optional scope expansion is `openid email` during connection if Nautilus does not already receive a validated identity.

## Referenced Full Calendar extension

The referenced `fbgallet/roam-extension-calendar` does not solve the multi-account deep-link problem:

- It requests and retains `htmlLink` in the fetched Google event data. ([googleCalendarService.js](https://github.com/fbgallet/roam-extension-calendar/blob/main/src/services/googleCalendarService.js#L3712-L3756), [gcalMapping.js](https://github.com/fbgallet/roam-extension-calendar/blob/main/src/util/gcalMapping.js#L1976-L2005))
- For a synced event's “open in Google Calendar” action, it ignores that `htmlLink` and reconstructs `https://calendar.google.com/calendar/event?eid=...`, then calls `window.open`. No `authuser`, `login_hint`, or account chooser is applied. ([Event.jsx](https://github.com/fbgallet/roam-extension-calendar/blob/main/src/components/Event.jsx#L3172-L3189))
- Its OAuth URL sets `prompt=consent`, but does not set `prompt=select_account` or `login_hint`. ([googleCalendarService.js](https://github.com/fbgallet/roam-extension-calendar/blob/main/src/services/googleCalendarService.js#L2638-L2674))

It is useful as an implementation reference for OAuth and event sync, but its event-opening behavior should not be copied as the multi-account fix.

## Evidence boundary

The official sources reviewed document `htmlLink`, OAuth account selection, Google default-account behavior, and Chrome profile isolation. They do **not** publish a stable Calendar event-deep-link contract for `authuser`, `/u/N`, or the generic `AccountChooser?continue=` wrapper. Those URL techniques can be compatibility fallbacks, but should be isolated, validated, tested, and never replace the exact API-returned `htmlLink` in stored data.
