FROM arangodb/arangodb:3.12
ENV ARANGO_NO_AUTH=1
# Constrain ArangoDB's self-detected RAM to 512 MB so it doesn't try to use
# all available memory and OOM before the HTTP server opens port 8529.
ENV ARANGODB_OVERRIDE_DETECTED_TOTAL_MEMORY=536870912
EXPOSE 8529
