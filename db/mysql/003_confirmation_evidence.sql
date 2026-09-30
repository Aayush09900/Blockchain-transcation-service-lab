-- Persist canonical block evidence so confirmed transactions can be revalidated after a chain reorganization.
ALTER TABLE transactions
  ADD COLUMN confirmed_block_number BIGINT UNSIGNED NULL,
  ADD COLUMN confirmed_block_hash CHAR(66) NULL,
  ADD KEY ix_transactions_confirmed_block (status, confirmed_block_number);
