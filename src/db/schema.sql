-- Minimal schema for the probe slice. Money is integer pennies in BIGINT,
-- per the brief's settled decision.
DROP TABLE IF EXISTS transactions, accounts, users CASCADE;

CREATE TABLE users (
  id                 TEXT PRIMARY KEY,
  name               TEXT        NOT NULL,
  address            JSONB       NOT NULL,
  phone_number       TEXT        NOT NULL,
  email              TEXT        NOT NULL UNIQUE,
  password_hash      TEXT        NOT NULL,
  created_timestamp  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_timestamp  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  account_number     TEXT PRIMARY KEY,
  user_id            TEXT        NOT NULL REFERENCES users(id),
  name               TEXT        NOT NULL,
  account_type       TEXT        NOT NULL,
  balance_pence      BIGINT      NOT NULL DEFAULT 0 CHECK (balance_pence >= 0),
  currency           TEXT        NOT NULL DEFAULT 'GBP',
  created_timestamp  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_timestamp  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transactions (
  id                 TEXT PRIMARY KEY,
  account_number     TEXT        NOT NULL REFERENCES accounts(account_number),
  user_id            TEXT        NOT NULL REFERENCES users(id),
  amount_pence       BIGINT      NOT NULL CHECK (amount_pence > 0),
  currency           TEXT        NOT NULL DEFAULT 'GBP',
  type               TEXT        NOT NULL CHECK (type IN ('deposit','withdrawal')),
  reference          TEXT,
  created_timestamp  TIMESTAMPTZ NOT NULL DEFAULT now()
);
