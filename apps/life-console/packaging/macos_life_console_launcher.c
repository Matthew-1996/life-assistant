#include <errno.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;

static volatile sig_atomic_t child_pid = -1;

static void forward_signal(int signal_number) {
    if (child_pid > 0) {
        kill((pid_t)child_pid, signal_number);
    }
}

int main(int argc, char **argv) {
    const char *python = getenv("LIFE_CONSOLE_PYTHON");
    if (python == NULL || python[0] == '\0') {
        fputs("LIFE_CONSOLE_PYTHON is required\n", stderr);
        return 64;
    }

    char **child_argv = calloc((size_t)argc + 1, sizeof(char *));
    if (child_argv == NULL) {
        perror("calloc");
        return 70;
    }
    child_argv[0] = (char *)python;
    for (int index = 1; index < argc; index++) {
        child_argv[index] = argv[index];
    }
    child_argv[argc] = NULL;

    pid_t pid = -1;
    int spawn_status = posix_spawn(&pid, python, NULL, NULL, child_argv, environ);
    free(child_argv);
    if (spawn_status != 0) {
        errno = spawn_status;
        perror("posix_spawn");
        return 70;
    }
    child_pid = pid;

    signal(SIGTERM, forward_signal);
    signal(SIGINT, forward_signal);
    signal(SIGHUP, forward_signal);

    int child_status = 0;
    while (waitpid(pid, &child_status, 0) < 0) {
        if (errno != EINTR) {
            perror("waitpid");
            return 70;
        }
    }
    child_pid = -1;

    if (WIFEXITED(child_status)) {
        return WEXITSTATUS(child_status);
    }
    if (WIFSIGNALED(child_status)) {
        return 128 + WTERMSIG(child_status);
    }
    return 70;
}
