import styles from './auditor.module.css';

export default function AuditorPage() {
    return (
        <div className={styles.container}>
            <div className={styles.card}>
                <header className={styles.header}>
                    <h1>Auditor Pack Generator</h1>
                    <p className="text-gray-500">Export compliance evidence for external audit.</p>
                </header>

                <form className={styles.form}>
                    <div className={styles.group}>
                        <label className={styles.label}>Audit Scope</label>
                        <select className={styles.select}>
                            <option value="all">Full Audit (All Standards)</option>
                            <option value="carf">CARF Only</option>
                            <option value="hipaa">HIPAA Only</option>
                        </select>
                    </div>

                    <div className={styles.group}>
                        <label className={styles.label}>Date Range</label>
                        <input type="date" className={styles.input} />
                    </div>

                    <button type="button" className={styles.generateBtn} disabled>
                        Generate Pack (Coming Soon)
                    </button>
                </form>
            </div>
        </div>
    );
}
