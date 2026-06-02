# Overwolf Status History

오버울프 게임 이벤트 상태를 **5분마다 기록**해 시간대별 이력을 남기는 저장소입니다.
Zendesk 사이드바 앱(Overwolf Status Monitor)이 **티켓 인입 시각 기준 과거 상태**를 조회하는 데 사용합니다.

오버울프는 "현재 상태"만 공개하고 과거 이력 API가 없기 때문에, 이 저장소가 직접 스냅샷을 쌓아 둡니다.

## 동작

- [.github/workflows/snapshot.yml](.github/workflows/snapshot.yml) 이 GitHub Actions cron으로 약 5분마다 실행됩니다.
- [scripts/snapshot.mjs](scripts/snapshot.mjs) 가 오버울프 상태를 받아 `data/YYYY-MM-DD.json`(UTC 날짜)에 한 줄씩 append 합니다.
- 앱은 `https://raw.githubusercontent.com/<OWNER>/<REPO>/main/data/<UTC날짜>.json` 을 읽어 가장 가까운 스냅샷을 찾습니다.

## 스냅샷 포맷

각 날짜 파일은 스냅샷 배열입니다:

```json
[
  { "t": "2026-06-02T04:00:11Z",
    "g": {
      "5426":  { "s": 1, "d": 0, "f": { "jungle_camps": 1, "augments": 1 } },
      "21570": { "s": 1, "d": 0, "f": { "store": 1 } },
      "21640": { "s": 2, "d": 0, "f": { "game_info": 1, "match_info": 2 } }
    } }
]
```

- `t`: UTC ISO 타임스탬프
- `g.<gameId>.s`: 게임 전체 상태 (1 정상 / 2 불안정 / 3 장애 / 0 확인불가)
- `g.<gameId>.d`: disabled 여부 (1이면 중단)
- `g.<gameId>.f`: 피처별 상태

## 설치 (최초 1회)

```bash
# 이 폴더에서
git init
git add .
git commit -m "init overwolf status history"
git branch -M main
git remote add origin https://github.com/<OWNER>/<REPO>.git
git push -u origin main
```

그다음 GitHub 저장소에서:

1. **Settings → Actions → General → Workflow permissions** → **Read and write permissions** 켜기 (봇이 커밋/푸시하려면 필요).
2. **Actions** 탭에서 워크플로가 활성화돼 있는지 확인 (포크/신규 저장소는 수동 활성화가 필요할 수 있음).
3. **Actions → overwolf-status-snapshot → Run workflow** 로 한 번 수동 실행해 첫 스냅샷 생성.

이후 5분마다 자동으로 쌓입니다. **기록을 시작한 시점 이후의 티켓**부터 과거 조회가 가능합니다.

## 주의

- GitHub 예약 워크플로는 부하 시 수 분~십수 분 지연되거나 건너뛸 수 있습니다. 오버울프 자체 반영 지연(5~10분)을 감안하면 "대략 그 시각" 조회에는 충분합니다.
- 약 5분마다 커밋이 생깁니다(하루 ~288개). 정상입니다.
- 기록 게임/피처를 바꾸려면 [scripts/snapshot.mjs](scripts/snapshot.mjs) 의 `GAMES` 와 앱의 `GAMES` 설정을 함께 맞춰주세요.
