-- Migration 24: tighten notification function execution grants

REVOKE EXECUTE ON FUNCTION public.create_notification(uuid, text, text, text, text, text[], text, uuid, text, uuid, uuid, uuid, text, numeric, numeric, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_stock_notification(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.evaluate_selling_option_stock_notification(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.evaluate_product_stock_notification(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_evaluate_selling_option_stock_notification() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_evaluate_product_stock_notification() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_notify_stock_adjustment() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_notify_sale_event() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_notify_error_log() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_notification_user_state() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.stock_option_display_label(text, text, text, numeric, text) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.notification_visible_to_user(uuid, text[], text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_notifications(uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_unread_notification_count(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_notification_read(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_all_notifications_read(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dismiss_notification(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_report_export_notification(uuid, text, text, text, jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.notification_visible_to_user(uuid, text[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_notifications(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_unread_notification_count(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_notification(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_report_export_notification(uuid, text, text, text, jsonb) TO authenticated;
