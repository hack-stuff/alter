from fastapi import HTTPException


def error(status: int, code: str, message: str):
    return HTTPException(status, {"error": {"code": code, "message": message}})
