# 运行与展示层生命周期

本目录只保存跨模块、可公开复用的运行规则。个人服务标识、访问链接、同步收据和运行时配置留在 iCloud 私有文件中，不进入 Git。

[`product-surfaces.json`](product-surfaces.json) 是展示层生命周期的唯一机器可读定义：

- iCloud 私有工作区是个人数据唯一真相源；
- Life Console 是唯一活跃产品代码与主要入口；本机版负责安全写入，私人 Sites 版按明确授权发布只读白名单快照；
- Google 表格和 XLSX 是按需生成的只读派生视图，不接受反向写回；
- Life Dashboard 源码已归档且不再部署；原私密 Sites 实例由 Life Console 私人只读版原位替换，不保留第二套活动前端。

状态工具、项目校验器、迁移 doctor 和 CI 必须核对这份清单，不得通过目录是否存在来猜测产品是否仍活跃。
