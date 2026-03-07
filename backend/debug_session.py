"""Quick test to see why get_session crashes."""
import asyncio, json, traceback

async def main():
    from app.database import get_db, init_db
    from app.models import SessionModel, SessionMessageModel
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from app.database import async_session
    from app.schema import MessageResponse, SessionResponse, SearchResultItem

    await init_db()

    async with async_session() as db:
        result = await db.execute(
            select(SessionModel)
            .options(selectinload(SessionModel.messages))
            .where(SessionModel.id == "139fdc8690ce")
        )
        session = result.scalar_one_or_none()
        if session is None:
            print("Session not found")
            return
        
        print(f"Session: {session.id}, messages: {len(session.messages)}")
        
        for m in session.messages:
            raw = getattr(m, 'citations_json', None) or '[]'
            print(f"  Message {m.id} role={m.role} citations_json type={type(raw)} val={raw[:100]}")
            try:
                parsed = json.loads(raw)
                print(f"    Parsed OK, {len(parsed)} citations")
                # Try to create a MessageResponse
                mr = MessageResponse(
                    id=m.id,
                    role=m.role,
                    content=m.content,
                    citations=parsed,
                    created_at=m.created_at,
                )
                messages_out.append(mr)
            except Exception as e:
                traceback.print_exc()
                print(f"    ERROR: {e}")

        try:
            sr = SessionResponse(
                id=session.id,
                project_id=session.project_id,
                title=session.title,
                created_at=session.created_at,
                updated_at=session.updated_at,
                messages=messages_out
            )
            print("SessionResponse OK")
        except Exception as e:
            traceback.print_exc()
            print(f"SessionResponse ERROR: {e}")

asyncio.run(main())
