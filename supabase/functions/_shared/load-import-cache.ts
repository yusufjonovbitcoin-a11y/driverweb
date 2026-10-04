// A review warning is a successful extraction, not a reason to call AI again.
export function reusableLoadImport(existing: any, version: number, checksum: string, grounded: boolean) {
  return Boolean(existing && ['extracted', 'needs_review'].includes(existing.status)
    && existing.load_id && existing.extracted_result
    && Number(existing.extraction_schema_version) === version
    && (!grounded || existing.raw_extraction?.candidate?.sourceManifest?.checksum === checksum));
}
