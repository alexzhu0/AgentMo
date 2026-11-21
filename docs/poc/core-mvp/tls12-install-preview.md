# TLS1.2兼容修复包：精确安装预览（待批准）

日期2026-11-10。提案sha256:7d267afc57286a2dea9def906eb3743a93cb512ea7cd6271071b2b4b0af73fd6；安装计划sha256:2fd764bc7d33a479954aec5b226db83f446c91ef9a3c975c9c9243ac2284b04b。仅安装，不运行SDK、激活、联网、读取.env或密钥、调用模型；新增真实预留0，不提交或push。

## 版本与确认元组

仍为field-extractor Pi CLI Agent，只提取当前会话明确提供的Product/Deadline，缺失为null，输出恰好两键JSON。来源、Discovery DB、Need与Blueprint同已批准旧版；本次重算绑定新源码的目标描述、Contract、Plan、Package，不增加领域功能。下列新Plan字节属于候选，只有用户明确批准本提案后才用于真实安装；不把内部approve字段当作真实用户授权。

| 工件 | SHA256 |
| --- | --- |
| 来源清单 | sha256:41e33c51132ad34fea0cb74610205a8578d29dcec546da85c9b7ccb208dcb1ad |
| Discovery DB | sha256:6a7cefe2e24d105e454307cf095ee0db219c5163f227cc7d94d79c46f08740ed |
| User Need | sha256:0a063405fb8524d15471cfb39665449831a9fd8e4d3ebccccb727b2811f41e55 |
| Blueprint | sha256:584c290fee7f589fc5a55391324e62ab1d770a7b6967105be924fa177524d6e5 |
| Discover预览 | sha256:fe864b19d36b2e52802a9f84765a606f64b559b15a3a23bf76c94e14a869a19d |
| Build Contract | sha256:7c098d7abcc9f473754e3abcd5e4742ae3134bcbc50c2c0f4e8cf12367df81d3 |
| 新Plan预览 | sha256:8ca675ba5e16e4ebca5767777e78855132589a9655bda96b6fbcae070be75df1 |
| 目标描述 | sha256:769e76d29bad7e6aabd0774feb50813663d7ac0f51fd693c746f0008cb4630fd |
| 当前源码闭包 | sha256:b67b3feefd5487fc2dcd7140631ecf0d5b723a0e3a636562a99b58e2935e57d7 |
| 候选.d42 | sha256:5cbc0685790a4e1b9fcbf20b0c9c0609dfd759dcf6ce44043128c906e8f26bf7 |
| 安装计划原字节 | sha256:3a8645d7a2d2b0f074604aa38b0071cdd7085cac9095b54fee8c38f662739208 |
| 已审阅预检控制器 | sha256:af055d8d781eb87de830195ee9c9f306e3c77a9205c84fa54f6286f7f67b11c0 |
| 已审阅安装控制器 | sha256:54f62af86b9d70880f92a2bf8f9c9b18ed57fb258ec93c62bdeb0b09cd4b0d3a |

源码仅在固定MiniMax HTTPS请求上指定TLS1.2最低/最高版本，保留证书验证、预算先预留、单次发送和失败停止；不改变全局TLS或其它provider。包清单规范序和CLI帮助修复也包含在此版本。此前HEAD成功仅证明TLS1.2连接候选，M3生成尚未验收。

## 获批后的写入

新根`.agentmo/field-extractor-pi-minimax-m3-tls12-2026-11-10-r1`当前不存在，旧安装保留。使用已有Pi安装器创建根及四个子目录attempts/browser/sessions/turns（0700），写入下列六文件（0600）。browser文件沿用通用Package，不启动浏览器或服务。

| 文件 | 字节 | SHA256 |
| --- | ---: | --- |
| agent.json | 473 | sha256:aa9d49e749b5c7ca2f50355d4aca464f4cba2ce5a09bceee8a0ebd8f01ae0c28 |
| browser/client.js | 6333 | sha256:9d6e66626a6b7c25b3b2382fa558994ee3a53659da2b4c6c1883dd4aa831e494 |
| browser/index.html | 2155 | sha256:18fac10343f2b1c2dd1fb8ecb7420cbb999602b36ab50f35bd81ab02fe3137cb |
| browser/style.css | 2703 | sha256:208b92b6e476873d8382c9865b8bf8a895cb3c2612f0d81b4e5ac6fa393ccac1 |
| runtime-binding.json | 884 | sha256:f3727c358f42a3f7b5ddbc31d4d41dbcb5a28f57b3d02f3a0d9c03a2a67de2b3 |
| system.md | 846 | sha256:546ff80bbfe45c619cb77a7265056f594f91f6ac09e7a3ce51baa7214bff4e38 |

沿用安装器的耐久started/complete/incomplete标记及install-receipt：按实际成功或失败有条件地产生，不伪造成功回执。无覆盖、迁移、删除或会话登记；失败保留现场，停止不补跑。

复用原authority存储，签发普通写入与空冲突两项新单次批准，追加一条消费：18消费/68决策→19/70，旧日志前缀保持。安装前journal必须仍为sha256:573f6c51a205c0f2f9a42f122d7b6eeaf6f4dcc51893d61a65ea0664c4e406f5。不初始化新存储，原预算4898分/30笔/10000分上限不变。

私有工件在`.superpowers/sdd/2026-11-10-tls12-mvp-closeout/candidate-r1`，控制器在其父目录；两份已审阅脚本另列上表摘要，派发前核验原字节。执行前重新核验精确提案、工件、SDK/Node/lock、源码、预算、authority和新根不存在；任何漂移即停止。真实用户批准文件当前不存在，安装执行器须先验证本提案批准才进入单次目录、签发决策或安装。

成功后只核验真实回执并准备独立只读激活预览。[四项M3准备预览](tls12-m3-preparation.md)不属于本次安装授权，也不能使用尚不存在的回执、会话或运行计划直接执行。
