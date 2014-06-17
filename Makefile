test:
	@./node_modules/.bin/mocha --require should --reporter spec test/*.test.js

.PHONY: all test
