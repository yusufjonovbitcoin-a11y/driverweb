-- create_document_import_draft relinks a reusable import after its former load
-- was removed but does not clear its old storage_path. When the new draft has
-- no Rate Con document at all, create a fresh source session for its verified
-- bytes. Do not reuse/delete the old file or weaken existing-document checks.
do $migration$
declare definition text:=pg_get_functiondef('public.begin_import_document_upload(uuid,text)'::regprocedure);
  anchor text:=E'    else\n      if imported.storage_path is not null then raise exception ''IMPORT_DOCUMENT_CONFLICT''; end if;\n      -- A new draft has no other source session.';
begin
  if strpos(definition,anchor)=0 then raise exception 'Unexpected source import upload guard'; end if;
  execute replace(definition,anchor,E'    else\n      -- The imported path can belong to a previously removed load. Only a\n      -- fresh upload for this new draft may replace that metadata on commit.\n      -- A new draft has no other source session.');
end $migration$;
notify pgrst,'reload schema';
