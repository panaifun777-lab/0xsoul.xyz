use num_derive::FromPrimitive;
use solana_program::program_error::ProgramError;
use thiserror::Error;

#[derive(Error, Debug, Copy, Clone, FromPrimitive, PartialEq)]
pub enum LaunchpadError {
    #[error("调用者未持有合法的 AgentPassport 凭证")]
    AgentPassportMissing,

    #[error("当前 Agent 处于封禁黑名单状态")]
    AgentBanned,

    #[error("单 Agent 持仓超过 1% (10,000,000 枚) 硬编码限购上限")]
    ExceedsOnePercentCap,

    #[error("代币已达 85 SOL 硬顶并成功毕业，内盘交易已永久关闭")]
    TokenAlreadyGraduated,

    #[error("滑点超出设定范围")]
    SlippageExceeded,

    #[error("数值计算溢出")]
    MathOverflow,

    #[error("募集资金未达目标")]
    TargetNotReached,

    #[error("募集超时已结盘或不可退款")]
    InvalidRefundState,

    #[error("无效的签名者或权限不足")]
    InvalidAuthority,

    #[error("AI 思考理由 (Thought Note) 超出 140 字节限制")]
    NoteTooLong,

    #[error("协议手续费收款地址与曲线登记的地址不一致（防篡改校验失败）")]
    InvalidFeeReceiver,

    #[error("曲线金库余额不足，无法支付卖出款项")]
    InsufficientPoolLiquidity,

    #[error("代币元数据非法：名称 1~32 字节、符号 1~10 字节、URI 1~200 字节")]
    InvalidTokenMetadata,

    #[error("代币精度必须为 6")]
    InvalidTokenDecimals,

    #[error("代币总供应量必须大于 0")]
    InvalidTotalSupply,

    #[error("发行费转账失败（创建者余额不足或收款地址异常）")]
    LaunchFeeTransferFailed,

    #[error("代币处于内盘募集期，转账已锁定；待毕业并迁移至 DEX 后方可自由转账")]
    TransferLockedBeforeGraduation,
}

impl From<LaunchpadError> for ProgramError {
    fn from(e: LaunchpadError) -> Self {
        ProgramError::Custom(e as u32)
    }
}
