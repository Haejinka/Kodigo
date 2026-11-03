# Auth email templates

Supabase Auth sends the signup confirmation and password recovery emails. The React registration page only starts signup, so configure each email's subject and HTML in Supabase.

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

The confirmation template uses `{{ .ConfirmationURL }}` for both the primary button and a short secondary “confirm email” hyperlink. It does not display the raw URL or include copy-and-paste fallback instructions. Keep the variable unchanged so Auth can generate and validate the one-time confirmation URL.

## Password recovery

In the Supabase Dashboard, open **Authentication → Email Templates → Reset Password** and set:

- Subject: `Reset your KodiGo password`
- Body: copy the contents of [`supabase/templates/recovery.html`](../supabase/templates/recovery.html)

For local Supabase Auth, configure the recovery template in `supabase/config.toml`:

```toml
[auth.email.template.recovery]
subject = "Reset your KodiGo password"
content_path = "./supabase/templates/recovery.html"
```

The recovery template uses `{{ .ConfirmationURL }}` in its primary button and a short secondary “reset password” hyperlink. It does not display the raw URL or include copy-and-paste fallback instructions. Keep the variable unchanged so Auth can generate and validate the one-time recovery URL.
