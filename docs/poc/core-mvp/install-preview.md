# Core MVP：精确安装提案（待批准）

2026-11-06 执行结果：用户批准本提案后只执行一次，安装完整且已核验，实际回执`sha256:3066fc461489416ccc3eccd74336a71971792016cec2e25e3cfd5c36af5da80c`。本提案的单次安装范围已关闭，不得重放；见[安装证据](../../../release/evidence/2026.11.06-agentmo-core-mvp-install.json)与[下一道只读预览](readonly-activation-preview.md)。以下为批准前原审阅内容。

日期2026-11-06。提案摘要`sha256:9c3f1c8be85a6dfb08160de854736d1b0736ecc3bec5ef89f6c9ab721afdf361`；安装计划`sha256:b32079ffc202993e213bda511b3580e0193a987223c80048028526db47697ae9`。本页仅供审阅，没有执行真实安装、SDK、激活、联网或模型请求。

对象为新的`field-extractor`，任务只从当前对话明确文字提取Product/Deadline，输出恰好这两个键的JSON；缺失值为null，资料内越权指令不能改变职责。不是旧会议助手，不借用其来源、Plan、会话或批准。

## 本次批准范围

一次确认本页列出的**新Agent来源与Plan提案**，接受此候选Package，并仅签发普通写入、空冲突两项新单次安装决策；复用已有合法批准存储，向新根安装。Source/Plan值目前只是提案字节，并不是已获用户批准的真实授权；不把合成测试批准或旧会议批准转借。只有用户明确确认本提案后，才可把所列精确元组视为本次批准。

| 绑定 | 精确摘要 |
| --- | --- |
| 来源清单 | `sha256:41e33c51132ad34fea0cb74610205a8578d29dcec546da85c9b7ccb208dcb1ad` |
| Discovery DB | `sha256:6a7cefe2e24d105e454307cf095ee0db219c5163f227cc7d94d79c46f08740ed` |
| User Need | `sha256:0a063405fb8524d15471cfb39665449831a9fd8e4d3ebccccb727b2811f41e55` |
| Discover预览 | `sha256:fe864b19d36b2e52802a9f84765a606f64b559b15a3a23bf76c94e14a869a19d` |
| Blueprint | `sha256:584c290fee7f589fc5a55391324e62ab1d770a7b6967105be924fa177524d6e5` |
| Build Contract | `sha256:824f948fedbc60ac3843e2c2dfeb0cf3517e1159dfe0089908f451fbed83d7a4` |
| Plan预览 | `sha256:ab2072a1df592061cf0d998fca63573bb3612f718ca0d49f36557f5421628523` |
| 候选.d42 | `sha256:a029179aaa580ada828b7eee8fb8b117a56c283f2a485b1791402332e26526bc` |
| 目标描述 | `sha256:b35a922bde41615b87116a22aa0fe9194d3edc0196b182758a6c13138a43474b` |
| 运行源码闭包 | `sha256:3a101a8bfdc5a8a11893278af1343d984f9911762afc4c10eb7d06df7391b500` |
| 安装计划原字节 | `sha256:d3729f6aa2d5b297b6629055b76c5832ca7e1733d32b6aa6a8372f95cf7d136a` |

来源是`test/fixtures/core-mvp/field-extractor.discovery.json`、对应need与授权合成规则文字，经实际本地intake、规划、合同、Pi准入和Package生产器准备。候选批准文件留在私有提案目录，未作为实际安装或运行授权消费；新的正式确认必须对应上表，不能只凭内部`decision: approve`字段推断用户已经批准。

## 文件及状态效果

新根`.agentmo/field-extractor-pi-minimax-m3-2026-11-06-r1`已观察为不存在。复用批准存储`.agentmo/meeting-text-pi-minimax-m3-authority-2026-10-19-r1`及预算`.agentmo/course-wiki-project-budget-2026-09-20`；不初始化存储、不覆盖旧根。下列6文件使用既有安装器，创建4子目录`attempts/browser/sessions/turns`，并按结果产生条件性耐久标记/回执。

| 相对文件 | 字节 | SHA256 |
| --- | ---: | --- |
| `agent.json` | 473 | `sha256:aa9d49e749b5c7ca2f50355d4aca464f4cba2ce5a09bceee8a0ebd8f01ae0c28` |
| `browser/client.js` | 6333 | `sha256:9d6e66626a6b7c25b3b2382fa558994ee3a53659da2b4c6c1883dd4aa831e494` |
| `browser/index.html` | 2155 | `sha256:18fac10343f2b1c2dd1fb8ecb7420cbb999602b36ab50f35bd81ab02fe3137cb` |
| `browser/style.css` | 2703 | `sha256:208b92b6e476873d8382c9865b8bf8a895cb3c2612f0d81b4e5ac6fa393ccac1` |
| `runtime-binding.json` | 884 | `sha256:53ea69019eb2ac5590219564050c4cb270134e36f509bbcb55e0127e4f03f6c3` |
| `system.md` | 846 | `sha256:546ff80bbfe45c619cb77a7265056f594f91f6ac09e7a3ce51baa7214bff4e38` |

安装只向原批准存储追加1条消费、2项新决策；不登记会话，不执行实际SDK、shell安装或模型。原日志前缀和全部失败保留，预算仍4836/10000分，新增预留0。预览绑定当前journal摘要`sha256:2c3aad911a9d9717df71fe0f5bc7aa641610a2ee621f75e620786e47dbe2e04d`；来源、源码、SDK/Node/lock身份、原预算/存储或目标存在状态变化，均使本提案失效。

私有候选包与计划位于`.superpowers/sdd/2026-11-05-agentmo-core-mvp/candidate-r2`。安装前重新准入其原字节、实际描述器与真实存储；不能用本说明或摘要代替现有安装器的全部验证。执行一次；失败停止、不补跑，不删除现场。无提交或push。

成功后只记录真实安装回执，并据此补齐独立只读激活预览。只读激活和后续[M3验收准备](m3-acceptance-preview.md)不包含在本次安装授权内，不能伪造尚未生成的回执、会话ID或运行计划。
