# Auth email templates

The signup email is sent by Supabase Auth. The React registration page only starts the signup request, so the email's subject and HTML must be configured in Supabase.

## Hosted project

In the Supabase Dashboard, open **Authentication → Email Templates → Confirm signup** and set:

- Subject: `Confirm your KodiGo account`
- Body: copy the contents of [`supabase/templates/confirmation.html`](../supabase/templates/confirmation.html)

Save the template and use the Dashboard preview or a test signup to verify it in both light and dark mode.

## Local Supabase

If local Auth is enabled, add this to `supabase/config.toml`:

```toml
[auth.email.template.confirmation]
subject = "Confirm your KodiGo account"
content_path = "./supabase/templates/confirmation.html"
```

The template intentionally uses only Supabase-supported variables needed for this flow, especially `{{ .ConfirmationURL }}`. Keep the link unchanged so Auth can generate and validate the one-time confirmation URL.
