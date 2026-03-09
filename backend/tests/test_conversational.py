import asyncio
import httpx
import uuid
import os

from app.schema import SearchRequest, SearchMode, ChatRequest

BASE_URL = "http://127.0.0.1:8000"

async def test_conversational():
    """Manual test to verify VERO's new SOTA conversational persona."""
    print("Testing VERO's Conversational Intelligence...")
    
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30.0) as client:
        # 1. Create a dummy project and session
        proj_id = uuid.uuid4().hex[:12]
        proj_res = await client.post(
            "/projects", 
            json={"name": f"Chat Test {proj_id}", "description": "Testing chat persona"}
        )
        
        if proj_res.status_code != 201:
            print(f"Failed to create project: {proj_res.text}")
            return
            
        actual_proj_id = proj_res.json()["id"]
        
        session_res = await client.post(f"/projects/{actual_proj_id}/sessions", json={"title": "Test Chat"})
        
        if session_res.status_code != 201:
            print(f"Failed to create session: {session_res.text}")
            return
            
        session_id = session_res.json()["id"]
        print(f"Created session: {session_id}")

        # 2. Test Greeting (No Sources)
        print("\n--- Test 1: The Greeting ---")
        prompt1 = "Hello VERO, how are you doing today?"
        print(f"User: {prompt1}")
        res1 = await client.post(
            f"/sessions/{session_id}/chat",
            json={"message": prompt1, "top_k": 3, "min_score": 0.0}
        )
        print(f"VERO: {res1.json()['answer']}")

        # 3. Test Missing Information
        print("\n--- Test 2: The Missing Data ---")
        prompt2 = "What does the employee handbook say about remote work?"
        print(f"User: {prompt2}")
        res2 = await client.post(
            f"/sessions/{session_id}/chat",
            json={"message": prompt2, "top_k": 3, "min_score": 0.0}
        )
        print(f"VERO: {res2.json()['answer']}")

        # 4. Test History Memory
        print("\n--- Test 3: The Memory ---")
        prompt3 = "Wait, what was the very first question I asked you?"
        print(f"User: {prompt3}")
        res3 = await client.post(
            f"/sessions/{session_id}/chat",
            json={"message": prompt3, "top_k": 3, "min_score": 0.0}
        )
        print(f"VERO: {res3.json()['answer']}")
        
        # 5. Test Praise
        print("\n--- Test 4: The Pleasantry ---")
        prompt4 = "Okay thanks! You're very helpful."
        print(f"User: {prompt4}")
        res4 = await client.post(
            f"/sessions/{session_id}/chat",
            json={"message": prompt4, "top_k": 3, "min_score": 0.0}
        )
        print(f"VERO: {res4.json()['answer']}")

if __name__ == "__main__":
    asyncio.run(test_conversational())
