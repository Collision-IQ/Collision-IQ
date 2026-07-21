# Collision IQ — UTM Conventions

Every outbound link in marketing content carries UTM parameters so HubSpot can
attribute visits, ROI-calculator submissions, and (eventually) closed deals back
to the exact post that drove them.

## Parameter scheme

| Parameter | Rule | Values in use |
|---|---|---|
| `utm_source` | The platform the click came from | `linkedin`, `twitter`, `instagram`, `youtube` |
| `utm_medium` | Always `social` for organic social posts (use `paid_social` for ads, `email` for sequences) | `social` |
| `utm_campaign` | The initiative, stable across all posts in it | `collision_iq_social_launch` |
| `utm_content` | The specific post/asset | `estimator_shortage_post`, `cv_pipeline_thread`, `mso_roi_case_study`, `teardown_shorts`, `carrier_rules_poll` |

## Destinations

- `https://www.collision-iq.ai/demo` — demo booking
- `https://www.collision-iq.ai/roi` — ROI calculator ⚠️ route does not exist yet;
  `web/roi_calculator.html` must be served at `/roi` (or adjust these links)
  before any post using it goes live.

## How attribution completes

1. The link's UTMs are captured by the HubSpot tracking script (installed on the
   ROI calculator page; portal 245899458, na2).
2. The tracking script sets the `hubspotutk` cookie; the ROI calculator's form
   submission sends that cookie, so the resulting contact inherits
   source/campaign attribution automatically.
3. In HubSpot, report on Contacts by `utm_campaign` / original source drill-down
   to see which posts produce leads, and follow the contact → deal association
   through to closed-won.

## Rules

- Never post a bare `collision-iq.ai` link in campaign content.
- One `utm_content` value per creative — if you A/B two versions of a post,
  suffix them (`teardown_shorts_a`, `teardown_shorts_b`).
- Keep values lowercase snake_case; UTMs are case-sensitive in reporting.
