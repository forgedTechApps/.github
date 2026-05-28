class HoroscopeService:
    async def get_today(self, user_id: str) -> dict:
        return {}

    # tenant-isolation: bypass — cron worker scans all users.
    async def compute_streaks(self) -> None:
        pass
