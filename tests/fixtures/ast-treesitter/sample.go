package sample

import (
	"fmt"
	"os"
	strpkg "strings"
)

const Version = "1.0.0"
const internalTag = "priv"

var Counter = 0
var logger = "default"

type Config struct {
	Verbose bool
}

type Handler func(int) int

func Greet(name string) string {
	return fmt.Sprintf("hello, %s", name)
}

func init() {
	_ = os.Getenv("HOME")
	_ = strpkg.ToUpper("x")
}

func privateHelper() {}
