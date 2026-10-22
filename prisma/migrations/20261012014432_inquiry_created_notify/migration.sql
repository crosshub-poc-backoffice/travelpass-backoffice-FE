-- 새 문의(Inquiry)가 생성되면 관리자 화면 실시간 알림용으로 pg_notify를 쏜다.
-- 구독 쪽: lib/server/inquiries/notify-relay.ts (LISTEN 'inquiry_created')
CREATE OR REPLACE FUNCTION notify_inquiry_created() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('inquiry_created', json_build_object('inquiryId', NEW.id)::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER inquiry_created_notify AFTER INSERT ON "Inquiry"
  FOR EACH ROW EXECUTE FUNCTION notify_inquiry_created();
