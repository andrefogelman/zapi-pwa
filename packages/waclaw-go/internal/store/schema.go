package store

import _ "embed"

//go:embed migrations/0001_initial.sql
var migration0001 string

//go:embed migrations/0002_chats_trigger.sql
var migration0002 string

//go:embed migrations/0003_lid_mapping.sql
var migration0003 string

//go:embed migrations/0004_reactions.sql
var migration0004 string

//go:embed migrations/0005_archived.sql
var migration0005 string

//go:embed migrations/0006_chat_flags.sql
var migration0006 string
