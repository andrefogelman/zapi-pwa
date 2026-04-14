.PHONY: build test testv lint fmt run clean install-deps

GO := go
BUILD_TAGS := sqlite_fts5
BIN_DIR := bin
BIN := $(BIN_DIR)/waclaw-go
PKG := ./...

build:
	@mkdir -p $(BIN_DIR)
	CGO_ENABLED=1 $(GO) build -tags $(BUILD_TAGS) -o $(BIN) ./cmd/waclaw-go

test:
	CGO_ENABLED=1 $(GO) test -tags $(BUILD_TAGS) $(PKG)

testv:
	CGO_ENABLED=1 $(GO) test -tags $(BUILD_TAGS) -v $(PKG)

lint:
	$(GO) vet -tags $(BUILD_TAGS) $(PKG)

fmt:
	$(GO) fmt $(PKG)

run: build
	./$(BIN)

clean:
	rm -rf $(BIN_DIR)

install-deps:
	$(GO) mod download
	$(GO) mod tidy
