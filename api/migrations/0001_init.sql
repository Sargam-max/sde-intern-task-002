-- Shared bill splitter schema.
-- D1 enforces foreign keys by default. Every constraint is named so a failure is easy to trace.

CREATE TABLE homes (
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT pk_homes PRIMARY KEY (id),
  CONSTRAINT ck_homes_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE TABLE members (
  id TEXT NOT NULL,
  home_id TEXT NOT NULL,
  name TEXT NOT NULL,
  -- 1, 2, 3 ... in the order members joined the home. Decides who gets the extra cents.
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT pk_members PRIMARY KEY (id),
  CONSTRAINT fk_members_home FOREIGN KEY (home_id) REFERENCES homes (id),
  CONSTRAINT ck_members_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT ck_members_position_positive CHECK (typeof(position) = 'integer' AND position > 0),
  -- Two members can never share a slot in the join order of one home.
  CONSTRAINT uq_members_home_position UNIQUE (home_id, position),
  -- Lets shares point at (member, home) so a share can only go to a member of the bill's home.
  CONSTRAINT uq_members_id_home UNIQUE (id, home_id)
);

CREATE TABLE bills (
  id TEXT NOT NULL,
  home_id TEXT NOT NULL,
  title TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT pk_bills PRIMARY KEY (id),
  CONSTRAINT fk_bills_home FOREIGN KEY (home_id) REFERENCES homes (id),
  CONSTRAINT ck_bills_title_not_blank CHECK (length(trim(title)) > 0),
  -- Money is whole cents: no decimals, no text, no zero or negative bills.
  CONSTRAINT ck_bills_total_positive_integer CHECK (
    typeof(total_cents) = 'integer' AND total_cents > 0
  ),
  CONSTRAINT uq_bills_id_home UNIQUE (id, home_id)
);

CREATE TABLE shares (
  id TEXT NOT NULL,
  bill_id TEXT NOT NULL,
  home_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  -- Order of the share inside its bill, same as the member order at split time.
  position INTEGER NOT NULL,
  paid_at TEXT,
  idempotency_key TEXT,
  CONSTRAINT pk_shares PRIMARY KEY (id),
  -- The share's bill and member must both belong to the same home.
  CONSTRAINT fk_shares_bill FOREIGN KEY (bill_id, home_id) REFERENCES bills (id, home_id),
  CONSTRAINT fk_shares_member FOREIGN KEY (member_id, home_id) REFERENCES members (id, home_id),
  CONSTRAINT ck_shares_amount_non_negative CHECK (
    typeof(amount_cents) = 'integer' AND amount_cents >= 0
  ),
  -- A share is either unpaid (no time, no key) or paid (both set). Never half paid.
  CONSTRAINT ck_shares_paid_has_key CHECK ((paid_at IS NULL) = (idempotency_key IS NULL)),
  -- One share per member per bill.
  CONSTRAINT uq_shares_bill_member UNIQUE (bill_id, member_id),
  CONSTRAINT uq_shares_bill_position UNIQUE (bill_id, position)
);

CREATE INDEX idx_bills_home ON bills (home_id, created_at);
CREATE INDEX idx_shares_member ON shares (member_id);
