package store

import _ "embed"

//go:embed migrations/0001_initial.sql
var migration0001 string

//go:embed migrations/0002_chats_trigger.sql
var migration0002 string
