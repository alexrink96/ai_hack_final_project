from fastapi import FastAPI, Request, Response, Body
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import uuid
from schemas import ChatRequest, ChatResponse
from ai_agent import get_ai_reply
import logging
from logging.handlers import RotatingFileHandler


logger = logging.getLogger("myapp")
logger.setLevel(logging.INFO)

file_handler = RotatingFileHandler(
    "app.log", maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
)
file_handler.setLevel(logging.INFO)

formatter = logging.Formatter(
    "%(asctime)s | %(levelname)s | %(name)s | %(message)s"
)
file_handler.setFormatter(formatter)
logger.addHandler(file_handler)

app = FastAPI()

chat_history = {}
server_state = {"deposits": []}
pending_actions = []

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.post("/chat", response_model=ChatResponse)
async def chat(request: Request, response: Response, payload: ChatRequest):
    session_id = request.cookies.get("session_id")
    if not session_id:
        session_id = str(uuid.uuid4())
        response.set_cookie(key="session_id", value=session_id, httponly=True)
        chat_history[session_id] = []

    history = chat_history.setdefault(session_id, [])

    reply = get_ai_reply(payload.message)

    return {"reply": reply}


@app.get("/history")
async def get_history(request: Request):
    session_id = request.cookies.get("session_id")
    if not session_id or session_id not in chat_history:
        return JSONResponse(content={"history": []})
    return JSONResponse(content={"history": chat_history[session_id]})


@app.get("/", response_class=HTMLResponse)
async def index():
    try:
        with open("static/index.html", "r", encoding="utf-8") as f:
            return f.read()
    except Exception as e:
        logger.error("Ошибка при загрузке index.html", exc_info=True)
        return HTMLResponse(content="Ошибка загрузки страницы", status_code=500)


@app.post("/api/open_deposit")
async def api_open_deposit(request: Request):
    try:
        data = await request.json()
        pending_actions.append({"type": "open_deposit", "payload": data})
        logger.info(f"💰 Действие открытия вклада: {data}")
        return JSONResponse(content={"status": "ok"})
    except Exception as e:
        logger.error("Ошибка /api/open_deposit", exc_info=True)
        return JSONResponse(content={"status": "error", "msg": str(e)})


@app.post("/api/close_deposit")
async def api_close_deposit(payload: dict = Body(...)):
    dep_id = payload.get("id")
    if not dep_id:
        logger.warning("close_deposit вызван без id")
        return JSONResponse(content={"status": "error", "msg": "Не указан ID вклада"})

    pending_actions.append({"type": "close_deposit", "payload": {"id": dep_id}})
    logger.info(f"💰 Действие закрытия вклада: {dep_id}")
    return JSONResponse(content={"status": "ok"})


@app.get("/api/poll_actions")
async def poll_actions():
    if pending_actions:
        actions = pending_actions.copy()
        pending_actions.clear()
        logger.info(f"📩 Проверка ожидающих действий: {actions}")
        return JSONResponse(content={"actions": actions})
    return JSONResponse(content={"actions": []})


@app.get("/api/deposits")
async def get_deposits():
    logger.info(f"🗓 Получение списка депозитов")
    return JSONResponse(content={"deposits": server_state["deposits"]})


@app.post("/api/sync_state")
async def sync_state(request: Request):
    global server_state
    try:
        server_state = await request.json()
        logger.info(f"✅ Состояние сервера синхронизировано")
        return {"status": "ok"}
    except Exception as e:
        logger.error("❌ Ошибка синхронизации состояния", exc_info=True)
        return {"status": "error", "msg": str(e)}
