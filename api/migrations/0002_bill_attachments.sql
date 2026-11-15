-- One uploaded file (PDF or image of the bill) per bill. Uploading again replaces it.
-- Files are small (max 1 MB) so they live in D1 next to the bill; see README "Decisions".

CREATE TABLE bill_attachments (
  bill_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  data BLOB NOT NULL,
  uploaded_at TEXT NOT NULL,
  -- At most one file per bill.
  CONSTRAINT pk_bill_attachments PRIMARY KEY (bill_id),
  -- A file cannot exist for a bill that does not exist.
  CONSTRAINT fk_bill_attachments_bill FOREIGN KEY (bill_id) REFERENCES bills (id),
  -- Only the file types the API can check and serve safely. No SVG or HTML (script risk).
  CONSTRAINT ck_bill_attachments_type CHECK (
    content_type IN ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')
  ),
  CONSTRAINT ck_bill_attachments_size CHECK (
    typeof(size_bytes) = 'integer' AND size_bytes > 0 AND size_bytes <= 1048576
    AND length(data) = size_bytes
  ),
  CONSTRAINT ck_bill_attachments_filename CHECK (
    length(trim(filename)) > 0 AND length(filename) <= 200
  )
);
