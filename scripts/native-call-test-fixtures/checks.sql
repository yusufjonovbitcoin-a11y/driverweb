set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000002';
select (register_push_device('native-android-a-token','android')).id as android_a \gset
select (register_push_device('native-android-b-token','android')).id as android_b \gset
select (register_push_device('native-web-device-token','web')).id as web_device \gset
select (register_push_device('native-iphone-fcm-token','ios')).id as iphone \gset
select test_assert(register_native_call_device('native-android-a-token')=:'android_a'::uuid,'native capability returns the owned device UUID');
select test_assert(register_native_call_device('unknown-token') is null,'unknown push token cannot opt in');
select (register_voip_device(repeat('a',64),'sandbox','com.test.calls','native-iphone-fcm-token')).id as voip \gset
select test_error($$select register_voip_device('bad','production','com.test.calls')$$,'Invalid VoIP registration');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select test_assert(not exists(select 1 from voip_devices),'VoIP tokens remain tenant-private');
select test_assert(not unregister_voip_device(repeat('a',64),'sandbox','com.test.calls'),'foreign account cannot unregister VoIP');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select (start_chat_call('00000000-0000-0000-0000-000000000010','audio')).id as native_call \gset
reset role;
select test_assert((select count(*)=5 from private.native_call_deliveries where call_id=:'native_call'),'call insert durably fans out to every registered device');
select test_assert((select bool_and(headers='{"Content-Type":"application/json"}'::jsonb and body=jsonb_build_object('call_id',:'native_call'::uuid)) from net.test_requests),'immediate wake never queues bearer or device secrets');
select test_assert((select bool_and(expires_at=c.started_at+interval '90 seconds') from private.native_call_deliveries d join chat_calls c on c.id=d.call_id where c.id=:'native_call'),'ringing deadline derives from unchanged started_at');
select test_assert(not has_function_privilege('authenticated','claim_native_call_deliveries(text,uuid,integer)','execute') and not has_function_privilege('anon','native_call_action(uuid,uuid,uuid,text)','execute'),'native delivery and action RPCs are service-only');
set role service_role;
select test_assert((native_call_action(:'native_call','00000000-0000-0000-0000-000000000002',:'android_a','status')->>'can_answer')::boolean,'signed status recipient may inspect active invitation');
select test_assert(native_call_action(:'native_call','00000000-0000-0000-0000-000000000003',:'android_a','status') is null,'wrong recipient cannot inspect invitation');
select test_error(format('select native_call_action(%L,%L,%L,%L)',:'native_call','00000000-0000-0000-0000-000000000002',:'android_a','accepted'),'Unsupported native action');
select test_assert((select count(*)=5 from claim_native_call_deliveries('test-worker',:'native_call',40)),'worker exclusively claims all existing destinations');
select test_assert((select count(*)=0 from claim_native_call_deliveries('other-worker',:'native_call',40)),'concurrent drains cannot claim the same delivery');
reset role;
select id as voip_delivery from private.native_call_deliveries where call_id=:'native_call' and transport='apns_voip' \gset
select id as fcm_delivery from private.native_call_deliveries where call_id=:'native_call' and device_id=:'iphone' \gset
set role service_role;
select test_assert(finish_native_call_delivery(:'voip_delivery','test-worker','fallback','No synthetic APNs config'),'missing APNs permits ordinary FCM fallback');
select test_assert(get_native_call_delivery(:'fcm_delivery','test-worker')->>'voip_delivery_status'='cancelled','linked fallback rechecks APNs outcome');
select test_assert(get_native_call_delivery(:'fcm_delivery','test-worker')->>'action_device_id'=:'voip','linked FCM and VoIP share one answer identity');
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000002';
select (claim_native_chat_call(:'native_call',:'android_a')).id;
select (claim_native_chat_call(:'native_call',:'android_a')).id;
select test_error(format('select claim_native_chat_call(%L,%L)',:'native_call',:'android_b'),'CALL_ANSWERED_ELSEWHERE');
select test_error(format('select respond_chat_call(%L,%L)',:'native_call','accepted'),'CALL_ANSWERED_ELSEWHERE');
select test_assert((finish_native_chat_call(:'native_call',:'android_b','ended')).status='accepted','losing device cannot end an accepted call');
select test_assert((finish_native_chat_call(:'native_call',:'android_a','declined')).status='accepted','late decline never hangs up an accepted winner');
select test_assert((finish_native_chat_call(:'native_call',:'android_a','ended')).status='ended','winning device can end its accepted call');
select test_assert((finish_native_chat_call(:'native_call',:'android_a','ended')).status='ended','winning device end retry is idempotent');

reset role;
select test_assert((select count(*)=0 from private.native_call_deliveries where call_id=:'native_call' and device_id=:'android_a' and call_status='accepted'),'accepted cancellation excludes winning device');
select test_assert((select count(*)=0 from private.native_call_deliveries where call_id=:'native_call' and event='call_ended' and transport='apns_voip'),'no silent cancellation uses VoIP');
select test_assert((select count(*)=0 from private.native_call_deliveries where call_id=:'native_call' and event='call_ended' and device_id=:'web_device'),'web cancellation never triggers a generic service-worker notification');
set role service_role;
select test_assert(not (native_call_action(:'native_call','00000000-0000-0000-0000-000000000002',:'android_b','status')->>'can_answer')::boolean,'other device status is no longer answerable');
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select (respond_chat_call(:'native_call','ended')).id;
select (start_chat_call('00000000-0000-0000-0000-000000000010','audio')).id as blocked_call \gset
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000002';
select set_chat_user_block('00000000-0000-0000-0000-000000000001',true);
select test_error(format('select claim_native_chat_call(%L,%L)',:'blocked_call',:'android_a'),'CHAT_BLOCKED');
reset role;
select test_assert((select count(*)>0 from private.native_call_deliveries where call_id=:'blocked_call' and event='call_ended'),'blocking always enqueues cancellation');
select test_assert((select count(*)=0 from private.native_call_deliveries where call_id=:'blocked_call' and event='incoming_call' and status in('pending','processing')),'blocking cancels every invitation lease');
set role service_role;
select test_assert(not (native_call_action(:'blocked_call','00000000-0000-0000-0000-000000000002',:'android_a','status')->>'can_answer')::boolean,'valid capability cannot bypass block');
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000002';
select set_chat_user_block('00000000-0000-0000-0000-000000000001',false);
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select (start_chat_call('00000000-0000-0000-0000-000000000010','audio')).id as decline_call \gset
set role service_role;
select test_assert(native_call_action(:'decline_call','00000000-0000-0000-0000-000000000002',:'android_a','decline')->>'status'='declined','native decline is atomic');
select test_assert(native_call_action(:'decline_call','00000000-0000-0000-0000-000000000002',:'android_a','decline')->>'status'='declined','native decline retry is idempotent');
reset role;
select worker_cron.invoke('native_calls');
select test_assert((select (request).uri like '%/process-native-call-push' and timeout_ms='12000' from extensions.test_requests order by ctid desc limit 1),'trusted cron uses dedicated native endpoint and bounded timeout');
select test_assert((select pg_get_constraintdef(oid) like '%document%' from pg_constraint where conrelid='worker_cron.last_invocations'::regclass and conname='last_invocations_worker_check'),'document worker remains permitted');

-- Expiry, durable retry leases, and device/account changes use synthetic local rows.
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select (start_chat_call('00000000-0000-0000-0000-000000000010','video')).id as expiry_call \gset
reset role;
update chat_calls set started_at=clock_timestamp()-interval '90 seconds' where id=:'expiry_call';
set role service_role;
select test_assert(native_call_action(:'expiry_call','00000000-0000-0000-0000-000000000002',:'android_a','status')->>'status'='missed','90-second deadline makes stale invitation unanswerable');
select test_assert(native_call_action(:'expiry_call','00000000-0000-0000-0000-000000000002',:'android_a','decline')->>'status'='missed','late decline does not revive an expired invitation');
select test_assert((select count(*)=0 from claim_native_call_deliveries('expired-worker',:'expiry_call',40)),'expired invitations never reach a provider');
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000002';
select test_error(format('select claim_native_chat_call(%L,%L)',:'expiry_call',:'android_a'),'Call is no longer ringing');
reset role;
update chat_calls set status='ended' where id=:'expiry_call';
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select (start_chat_call('00000000-0000-0000-0000-000000000010','audio')).id as registry_call \gset
set role service_role;
select count(*) from claim_native_call_deliveries('crashed-worker',:'registry_call',40);
reset role;
update private.native_call_deliveries set locked_at=clock_timestamp()-interval '21 seconds' where call_id=:'registry_call';
set role service_role;
select test_assert((select count(*)=5 from claim_native_call_deliveries('recovered-worker',:'registry_call',40)),'expired worker leases are recovered without losing invitations');
reset role;
select id as retry_delivery from private.native_call_deliveries where call_id=:'registry_call' and device_id=:'android_a' \gset
set role service_role;
select test_assert(not finish_native_call_delivery(:'retry_delivery','crashed-worker','sent'),'stale worker cannot finalize another lease');
reset role;
update profiles set status='inactive' where id='00000000-0000-0000-0000-000000000001';
set role service_role;
select test_assert(not (native_call_action(:'registry_call','00000000-0000-0000-0000-000000000002',:'android_a','status')->>'can_answer')::boolean,'deactivated caller cannot remain answerable');
select test_assert(get_native_call_delivery(:'retry_delivery','recovered-worker') is null,'deactivation is rechecked immediately before provider delivery');
reset role;
update profiles set status='active' where id='00000000-0000-0000-0000-000000000001';
set role authenticated;
reset role;
select id as invalid_fcm_delivery from private.native_call_deliveries where call_id=:'registry_call' and device_id=:'iphone' \gset
set role service_role;
select test_assert(finish_native_call_delivery(:'invalid_fcm_delivery','recovered-worker','invalid_token'),'invalid FCM delivery is finalized');
reset role;
select test_assert((select disabled_at is null and fcm_device_id is null from voip_devices where id=:'voip'),'FCM rejection preserves valid independent APNs registration');
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000002';
select (register_push_device('native-iphone-fcm-token','ios')).id;
select (register_voip_device(repeat('a',64),'sandbox','com.test.calls','native-iphone-fcm-token')).id;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000003';
select (register_push_device('native-iphone-fcm-token','ios')).id;
reset role;
select test_assert((select disabled_at is not null from voip_devices where id=:'voip'),'FCM account switch invalidates linked VoIP device');
select test_assert((select not native_calls from push_devices where id=:'iphone'),'account switch never inherits native capability');
set role service_role;
select test_assert(native_call_action(:'registry_call','00000000-0000-0000-0000-000000000002',:'voip','status') is null,'old signed device capability is invalid after account switch');
reset role;
select test_assert(not private.native_call_delivery_allowed(d),'old account FCM delivery becomes ineligible') from private.native_call_deliveries d where call_id=:'registry_call' and device_id=:'iphone';
select test_assert(not private.native_call_delivery_allowed(d),'old account VoIP delivery becomes ineligible') from private.native_call_deliveries d where call_id=:'registry_call' and device_id=:'voip';
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000002';
select (register_push_device('native-iphone-fcm-token','ios')).id;
select (register_voip_device(repeat('a',64),'sandbox','com.test.calls','native-iphone-fcm-token')).id;
reset role;
delete from push_devices where id=:'iphone';
select test_assert((select disabled_at is not null and fcm_device_id is null from voip_devices where id=:'voip'),'FCM logout deletion invalidates linked VoIP registration');
set role authenticated;
select test_assert(unregister_voip_device(repeat('a',64),'sandbox','com.test.calls'),'owner may explicitly unregister VoIP on logout');
select test_assert(not unregister_voip_device(repeat('a',64),'sandbox','com.test.calls'),'VoIP logout retry is idempotent');
reset role;
