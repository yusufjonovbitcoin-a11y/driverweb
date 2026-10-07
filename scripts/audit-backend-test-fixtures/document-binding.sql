reset role;
select test_seed_load('00000000-0000-0000-0000-000000009500');
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select begin_document_upload('00000000-0000-0000-0000-000000009500',null,'rate_confirmation','audit.pdf','application/pdf')->>'versionId' as binding_version \gset
select test_assert(can_access_load_media_context(:'binding_version'::uuid),'initial upload lease authorizes media');
reset role;
-- Two synthetic provider records represent two uploads during one open lease.
insert into media_assets(id,company_id,scope,context_id,public_id,resource_type,delivery_type)
values('00000000-0000-0000-0000-000000009501','00000000-0000-0000-0000-000000000020','load_document',:'binding_version','synthetic-A','raw','authenticated'),
('00000000-0000-0000-0000-000000009502','00000000-0000-0000-0000-000000000020','load_document',:'binding_version','synthetic-B','raw','authenticated');
set role authenticated;
select (bind_document_version_media(:'binding_version'::uuid,'cloudinary:00000000-0000-0000-0000-000000009501','checksum-A')).id;
select test_assert(not can_access_load_media_context(:'binding_version'::uuid),'first binding closes upload lease');
reset role;
update document_checks set status='passed',result='{"synthetic":"reviewed-A"}' where document_version_id=:'binding_version';
update jobs set status='completed',locked_at=null,locked_by=null where idempotency_key='document-check:'||:'binding_version';
set role authenticated;
select test_error(format('select bind_document_version_media(%L,%L,%L)',:'binding_version','cloudinary:00000000-0000-0000-0000-000000009502','checksum-B'),'DOCUMENT_VERSION_IMMUTABLE');
select (bind_document_version_media(:'binding_version'::uuid,'cloudinary:00000000-0000-0000-0000-000000009501','checksum-A')).id;
select test_error(format('select bind_document_version_media(%L,%L,%L)',:'binding_version','cloudinary:00000000-0000-0000-0000-000000009501','changed-checksum'),'DOCUMENT_VERSION_IMMUTABLE');
reset role;
select test_assert((select storage_path='cloudinary:00000000-0000-0000-0000-000000009501' from document_versions where id=:'binding_version'),'finalized version still points to reviewed asset');
select test_assert((select count(*)=1 and bool_and(status='passed') from document_checks where document_version_id=:'binding_version'),'same-file retry preserves one completed review');
select test_assert((select count(*)=1 and bool_and(status='completed') from jobs where idempotency_key='document-check:'||:'binding_version'),'same-file retry creates no orphan review/job');
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000005';
select test_error(format('select bind_document_version_media(%L,%L,%L)',:'binding_version','cloudinary:00000000-0000-0000-0000-000000009501','checksum-A'),'Upload not found');
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select begin_document_upload('00000000-0000-0000-0000-000000009500',null,'photo','storage.png','image/png')->>'versionId' as storage_version \gset
reset role;
insert into storage.objects(bucket_id,name) select 'load-documents',storage_path from document_versions where id=:'storage_version';
set role authenticated;
select (complete_document_upload(:'storage_version'::uuid,'storage-checksum')).id;
select (complete_document_upload(:'storage_version'::uuid,'storage-checksum')).id;
select test_error(format('select complete_document_upload(%L,%L)',:'storage_version','different'),'DOCUMENT_VERSION_IMMUTABLE');
reset role;
select test_assert((select count(*)=1 from document_checks where document_version_id=:'storage_version'),'legacy Storage retry preserves one check');

-- Out-of-order finalization must not revive a superseded open upload lease.
set role authenticated;
set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000001';
select begin_document_upload('00000000-0000-0000-0000-000000009500',null,'rate_confirmation','older.pdf','application/pdf')->>'versionId' as older_version \gset
select begin_document_upload('00000000-0000-0000-0000-000000009500',null,'rate_confirmation','newer.pdf','application/pdf')->>'versionId' as newer_version \gset
reset role;
insert into media_assets(id,company_id,scope,context_id,public_id,resource_type,delivery_type)
values('00000000-0000-0000-0000-000000009503','00000000-0000-0000-0000-000000000020','load_document',:'older_version','older','raw','authenticated'),
('00000000-0000-0000-0000-000000009504','00000000-0000-0000-0000-000000000020','load_document',:'newer_version','newer','raw','authenticated');
set role authenticated;
select (bind_document_version_media(:'newer_version'::uuid,'cloudinary:00000000-0000-0000-0000-000000009504','new')).id;
select test_error(format('select bind_document_version_media(%L,%L,%L)',:'older_version','cloudinary:00000000-0000-0000-0000-000000009503','old'),'DOCUMENT_VERSION_SUPERSEDED');
select test_error(format('select complete_document_upload(%L,%L)',:'older_version','old'),'DOCUMENT_VERSION_SUPERSEDED');
-- A retry of the previously finalized version stays a harmless no-op.
select (bind_document_version_media(:'binding_version'::uuid,'cloudinary:00000000-0000-0000-0000-000000009501','checksum-A')).id;
reset role;
select test_assert((select current_version_id=:'newer_version' from documents where id=(select document_id from document_versions where id=:'newer_version')),'late upload/retry cannot replace the newest committed version');
select test_assert(not exists(select 1 from document_checks where document_version_id=:'older_version'),'superseded lease never receives an unprocessable review');

-- Preserve the existing immutable evidence rules after a required stop is done.
insert into load_stops(id,company_id,load_id,type,sequence,address_line,city,region,requires_document)
values('00000000-0000-0000-0000-000000009505','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000009500','pickup',1,'Test street','Test','NJ',true);
set role authenticated;
select begin_document_upload('00000000-0000-0000-0000-000000009500','00000000-0000-0000-0000-000000009505','bol','bol.pdf','application/pdf')->>'versionId' as bol_version \gset
reset role;
insert into media_assets(id,company_id,scope,context_id,public_id,resource_type,delivery_type)
values('00000000-0000-0000-0000-000000009506','00000000-0000-0000-0000-000000000020','load_document',:'bol_version','bol','raw','authenticated');
set role authenticated;
select (bind_document_version_media(:'bol_version'::uuid,'cloudinary:00000000-0000-0000-0000-000000009506','bol-checksum')).id;
reset role;
update document_checks set status='passed' where document_version_id=:'bol_version';
update load_stops set status='done' where id='00000000-0000-0000-0000-000000009505';
set role authenticated;
select (bind_document_version_media(:'bol_version'::uuid,'cloudinary:00000000-0000-0000-0000-000000009506','bol-checksum')).id;
select test_error(format('select bind_document_version_media(%L,%L,%L)',:'bol_version','cloudinary:00000000-0000-0000-0000-000000009502','other'),'DOCUMENT_VERSION_IMMUTABLE');
reset role;
select test_error(format('update document_versions set checksum_sha256=%L where id=%L','mutated',:'bol_version'),'Finalized BOL/POD version is immutable');
select test_assert((select count(*)=1 and bool_and(status='passed') from document_checks where document_version_id=:'bol_version'),'completed-stop same-file retry keeps the original reviewed evidence');
-- An old execution's upload must still fail even if its file is identical.
update loads set execution_reset_at=now()+interval '1 second' where id='00000000-0000-0000-0000-000000009500';
set role authenticated;
select test_error(format('select bind_document_version_media(%L,%L,%L)',:'binding_version','cloudinary:00000000-0000-0000-0000-000000009501','checksum-A'),'LOAD_DOCUMENT_STALE');
reset role;
