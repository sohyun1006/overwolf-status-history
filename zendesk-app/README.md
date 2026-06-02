# Overwolf Status Monitor (Zendesk 사이드바 앱)

오버울프(Overwolf) 게임 이벤트 데이터가 **안정/불안정** 상태인지 한눈에 보여주는 Zendesk 앱입니다.
TFT · LoL · 발로란트 오버레이가 의존하는 오버울프 데이터의 실시간 상태를 표시해, 상담원이
"오버레이가 안 떠요" 문의가 오버울프 측 데이터 이슈인지 빠르게 판단할 수 있게 돕습니다.

## 동작 방식

오버울프가 제공하는 **공개** 상태 엔드포인트를 브라우저에서 직접 조회합니다(별도 서버·API 키 불필요).

```
https://game-events-status.overwolf.com/{gameId}_prod.json
```

| 상태 코드 | 의미 |
|----------|------|
| `1` | 정상 (🟢) |
| `2` | 일부 불안정 (🟡) |
| `3` | 장애 (🔴) |
| `0` | 확인 불가 (⚪) |

`disabled` 플래그가 켜져 있으면 중단(장애)으로 처리합니다.
오버울프 서버 반영까지 **최대 5~10분 지연**이 있을 수 있습니다.

## 모니터링 항목

[assets/main.js](assets/main.js) 상단 `GAMES` 설정에서 오버레이 ↔ 오버울프 피처 매핑을 관리합니다.

| 게임 | 오버레이 | 오버울프 피처 |
|------|---------|--------------|
| LoL (`5426`) | 정글 타이머 | `jungle_camps` |
| LoL (`5426`) | 증바람 증강체 | `augments` |
| TFT (`21570`) | 증강체 오버레이 | 게임 전체 상태 (`_game`)\* |
| TFT (`21570`) | 상점 알림 | `store` |
| 발로란트 (`21640`) | 라운드별 정보 | `game_info` + `match_info` |

\* TFT 증강체 데이터는 라이엇 TOS상 오버울프가 공개 status로 노출하지 않아 게임 전체 상태로 대체 표시합니다.

오버레이가 의존하는 피처가 바뀌면 `GAMES` 배열만 수정하면 됩니다.
`feature` 값은 문자열, 배열(가장 나쁜 상태 채택), 또는 `"_game"`(게임 전체 상태)을 지원합니다.

## 설치

### 방법 A — 관리자 업로드 (간단)

1. 이 폴더 전체를 zip으로 압축합니다 (manifest.json이 zip 최상위에 오도록).
2. Zendesk 관리 센터 → **앱 및 통합 → 앱 → Zendesk Support 앱 → 비공개 앱 업로드**.
3. zip을 업로드하고 설치합니다.
4. 티켓을 열면 우측 **사이드바**, 또는 상단 **내비게이션 바**에서 앱이 보입니다.

### 방법 B — ZCLI (개발용)

```bash
npm install -g @zendesk/zcli
zcli apps:validate .      # manifest/번역 검증
zcli apps:server .        # 로컬 미리보기: 서브도메인 URL 뒤에 ?zcli_apps=true 붙여 접속
zcli apps:create .        # 비공개 앱으로 업로드
```

## 로컬 미리보기 (Zendesk 없이)

[assets/iframe.html](assets/iframe.html)을 브라우저에서 바로 열면 동작합니다.
(ZAF SDK가 없으면 자동으로 standalone 모드로 떨어져 데이터만 렌더링)

## 표시 위치 변경

[manifest.json](manifest.json)의 `location.support`에서 `ticket_sidebar` / `nav_bar`를
필요에 따라 추가·삭제하세요.
