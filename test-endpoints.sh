#!/bin/bash

# Test script for Learnline API endpoints
# Usage: ./test-endpoints.sh [base_url]

BASE_URL=${1:-"https://cursor-mvp-learnline-production.up.railway.app"}

echo "🧪 Testing Learnline API endpoints at: $BASE_URL"
echo "================================================"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to test endpoint
test_endpoint() {
    local method=$1
    local endpoint=$2
    local data=$3
    local description=$4
    
    echo -e "\n${YELLOW}Testing: $description${NC}"
    echo "Endpoint: $method $BASE_URL$endpoint"
    
    if [ "$method" = "GET" ]; then
        response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "$BASE_URL$endpoint")
    else
        response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X "$method" \
            -H "Content-Type: application/json" \
            -d "$data" \
            "$BASE_URL$endpoint")
    fi
    
    http_status=$(echo "$response" | grep -o 'HTTP_STATUS:[0-9]*' | cut -d':' -f2)
    body=$(echo "$response" | sed -n '1,/HTTP_STATUS:/p' | sed '$d')
    
    if [ "$http_status" -ge 200 ] && [ "$http_status" -lt 300 ]; then
        echo -e "${GREEN}✅ Success (HTTP $http_status)${NC}"
        echo "Response: $(echo $body | jq . 2>/dev/null || echo $body)"
    else
        echo -e "${RED}❌ Failed (HTTP $http_status)${NC}"
        echo "Response: $(echo $body | jq . 2>/dev/null || echo $body)"
    fi
}

# Test 1: Health Check
test_endpoint "GET" "/api/health" "" "Health Check"

# Test 2: Diagnostics (if available)
test_endpoint "GET" "/api/diagnostics" "" "Environment Diagnostics"

# Test 3: Test Connection
test_endpoint "GET" "/api/test-connection" "" "Test Connection"

# Test 4: Test Google Auth
test_endpoint "GET" "/api/test-google-auth" "" "Test Google Authentication"

# Test 5: RAG Status
test_endpoint "GET" "/api/rag/status" "" "RAG Service Status"

# Test 5.1: RNNoise Health Check
test_endpoint "GET" "/api/health-rnnoise" "" "RNNoise System Health"

# Test 5.2: RNNoise Diagnostics
test_endpoint "GET" "/api/rnnoise-diagnostics" "" "RNNoise Diagnostic Report"

# Test 5.3: RNNoise Error History
test_endpoint "GET" "/api/rnnoise-errors?limit=10" "" "RNNoise Error History"

# Test 6: Ask Teacher (Simple Question)
test_endpoint "POST" "/api/ask-teacher" \
    '{"question":"नमस्ते, आप कैसे हैं?"}' \
    "Ask Teacher - Simple Hindi Question"

# Test 7: Speech-to-Text (with dummy audio)
echo -e "\n${YELLOW}Testing: Speech-to-Text Endpoint${NC}"
echo "Note: This will likely fail without real audio data"
test_endpoint "POST" "/api/speech-to-text" \
    '{"audio":"dGVzdA==","language":"hi-IN","mimeType":"audio/webm"}' \
    "Speech-to-Text (dummy data)"

# Test 8: TTS Endpoint
test_endpoint "POST" "/api/tts" \
    '{"text":"Hello, this is a test","provider":"google","voiceConfig":{"languageCode":"hi-IN"}}' \
    "Text-to-Speech"

# Test 9: CORS Preflight
echo -e "\n${YELLOW}Testing: CORS Preflight Request${NC}"
echo "Endpoint: OPTIONS $BASE_URL/api/ask-teacher"
cors_response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
    -X OPTIONS \
    -H "Origin: http://localhost:3000" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: Content-Type" \
    "$BASE_URL/api/ask-teacher")

cors_status=$(echo "$cors_response" | grep -o 'HTTP_STATUS:[0-9]*' | cut -d':' -f2)
cors_headers=$(curl -s -I -X OPTIONS \
    -H "Origin: http://localhost:3000" \
    -H "Access-Control-Request-Method: POST" \
    "$BASE_URL/api/ask-teacher" | grep -i "access-control")

if [ "$cors_status" -eq 200 ] || [ "$cors_status" -eq 204 ]; then
    echo -e "${GREEN}✅ CORS Preflight Success (HTTP $cors_status)${NC}"
    echo "CORS Headers:"
    echo "$cors_headers"
else
    echo -e "${RED}❌ CORS Preflight Failed (HTTP $cors_status)${NC}"
fi

echo -e "\n================================================"
echo "🏁 Testing complete!"
echo ""
echo "Next steps:"
echo "1. Check Railway logs for any server errors"
echo "2. Ensure all environment variables are set in Railway"
echo "3. If CORS fails, redeploy the server with the fixes"
echo "4. Test from the mobile app with detailed console logging"