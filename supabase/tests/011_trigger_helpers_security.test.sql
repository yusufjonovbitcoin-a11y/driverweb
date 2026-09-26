begin;

select plan(4);

select ok(
  not has_function_privilege(
    'anon',
    'public.enqueue_abandoned_document_upload_cleanup()',
    'EXECUTE'
  ),
  'anonymous users cannot invoke abandoned upload cleanup trigger helper'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.enqueue_abandoned_document_upload_cleanup()',
    'EXECUTE'
  ),
  'authenticated users cannot invoke abandoned upload cleanup trigger helper'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.enqueue_push_notification()',
    'EXECUTE'
  ),
  'anonymous users cannot invoke push fanout trigger helper'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.enqueue_push_notification()',
    'EXECUTE'
  ),
  'authenticated users cannot invoke push fanout trigger helper'
);

select * from finish();

rollback;
