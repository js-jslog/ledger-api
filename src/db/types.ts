export interface UsersTable {
  id: string
  name: string
  address: { line1: string; line2?: string; line3?: string; town: string; county: string; postcode: string }
  phone_number: string
  email: string
  password_hash: string
  created_timestamp: Date
  updated_timestamp: Date
}

export interface AccountsTable {
  account_number: string
  user_id: string
  name: string
  account_type: 'personal'
  balance_pence: number
  currency: 'GBP'
  created_timestamp: Date
  updated_timestamp: Date
}

export interface TransactionsTable {
  id: string
  account_number: string
  user_id: string
  amount_pence: number
  currency: 'GBP'
  type: 'deposit' | 'withdrawal'
  reference: string | null
  created_timestamp: Date
}

export interface DB {
  users: UsersTable
  accounts: AccountsTable
  transactions: TransactionsTable
}
